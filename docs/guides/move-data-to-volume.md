---
status: living
audience: operators
last_reviewed: 2026-11-23
---

# Move server data onto an attached volume

A Mediforce server writes almost everything to three directories, all on the
root disk by default:

| Directory | What lives there | Typical size |
|---|---|---|
| `/var/lib/containerd` | Docker image layers, when Docker uses the containerd image store | tens of GB (agent images are large) |
| `/var/lib/docker` | containers, named volumes (Postgres, Redis, Caddy), build cache; image layers too on the classic `overlay2` store | GB to tens of GB |
| `/var/lib/mediforce` | run worktrees, bare repos, Output File attachments | grows with every run |

Hetzner servers come with a small root disk, and a volume you attach is not
used until you point something at it. This guide moves those three
directories onto the volume using **bind mounts**. With a bind mount the paths
stay the same, so nothing in
[`docker-compose.prod.yml`](../../docker-compose.prod.yml) changes. That
matters: the container-worker starts agent containers through
`docker.sock` with host paths under `/var/lib/mediforce`, and those paths
must stay the same.

[`scripts/bootstrap-server.py`](../../scripts/bootstrap-server.py) does not do
this, so run this guide on every new server that has a volume.

## Before you start

- You need `sudo` on the server. The `deploy` user has no password-less sudo.
- Plan for downtime: **20–45 minutes** for about 60 GB, plus about 2 minutes
  for the reboot test. The copy speed depends on the volume. No runs
  can execute during the window.
- Every command below runs on the server. Set these once per shell:

  ```bash
  V=/mnt/HC_Volume_107476646      # the volume's mount point, from `df -h`
  cd /opt/mediforce
  COMPOSE="docker compose -f docker-compose.prod.yml"
  ```

  The example values are production's. Get the volume path from
  `df -h` or `grep HC_Volume /etc/fstab`.

## 1. Check which image store Docker uses

```bash
docker info --format '{{.Driver}} {{json .DriverStatus}}'
```

- `overlayfs` with `io.containerd.snapshotter.v1` means the **containerd image
  store**. Image layers are in `/var/lib/containerd`. Move all three
  directories. This is the default for new installs of Docker 29 and later,
  and it is how production is set up.
- `overlay2` means the **classic store**. Image layers are in
  `/var/lib/docker`, and `/var/lib/containerd` is small. Moving it is still
  harmless. Keep it in the list so all servers look the same.

If you skip `/var/lib/containerd` on the containerd store, you move a few GB
and leave the images, which take most of the space, on root.

## 2. Check sizes and free space on the volume

```bash
sudo du -sh /var/lib/containerd /var/lib/docker /var/lib/mediforce
df -h "$V"
```

The total must fit on the volume, with room to grow. Remove unused images and
build cache first, so you don't copy them:

```bash
docker image prune -f
docker builder prune -f
```

## 3. Back up Postgres and record row counts

Postgres lives in the `mediforce_postgres-data` named volume inside
`/var/lib/docker`, so it moves with that directory. Take a dump first:

```bash
sudo mkdir -p "$V/backups" && sudo chown "$USER" "$V/backups"
docker exec mediforce-postgres-1 pg_dump -U mediforce -Fc mediforce \
  > "$V/backups/mediforce-$(date +%F-%H%M).dump"
ls -lh "$V/backups"
```

Copy the dump off the server too, for example with `scp` to your machine.
A backup on the same host does not protect you if the volume is lost.

Record exact row counts for every table, to compare after the move:

```bash
docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -At -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(
           format('select count(*) as c from %I.%I', table_schema, table_name),
           false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by 1" > "$V/backups/rowcounts-before.txt"
```

## 4. Stop the stack, then Docker

Stop the containers first with a long timeout so Postgres shuts down cleanly.
If you only stop the daemon, each container gets about 15 seconds before it
is killed.

```bash
$COMPOSE stop -t 60          # stop, NOT down -v
sudo systemctl stop docker docker.socket containerd
systemctl is-active docker docker.socket containerd   # all three: inactive
```

`docker.socket` must be stopped, or the first `docker` command would start
the daemon again in the middle of the copy.

## 5. Copy the data

```bash
for d in containerd docker mediforce; do
  sudo rsync -aHAXS --numeric-ids --info=progress2 "/var/lib/$d/" "$V/$d/"
done
```

Every flag matters. `-H` keeps hard links and `-X` keeps extended attributes.
The overlay image layers depend on both. `-S` handles sparse files, and
`--numeric-ids` keeps file ownership exactly as it is. The Postgres data is
owned by UID 70 inside the container, which has no matching name on the host.

Confirm the copy is complete. This second pass must list nothing:

```bash
for d in containerd docker mediforce; do
  sudo rsync -aHAXS --numeric-ids --dry-run --itemize-changes "/var/lib/$d/" "$V/$d/"
done
```

## 6. Swap in bind mounts

Keep the originals until the move is proven. Rename them rather than deleting
them:

```bash
for d in containerd docker mediforce; do
  sudo mv "/var/lib/$d" "/var/lib/$d.old"
  sudo mkdir "/var/lib/$d"
done
```

Add the bind mounts to `/etc/fstab`. They must come **after** the volume's
own line:

```bash
sudo tee -a /etc/fstab <<EOF
$V/containerd /var/lib/containerd none bind,nofail,x-systemd.requires-mounts-for=$V 0 0
$V/docker     /var/lib/docker     none bind,nofail,x-systemd.requires-mounts-for=$V 0 0
$V/mediforce  /var/lib/mediforce  none bind,nofail,x-systemd.requires-mounts-for=$V 0 0
EOF
sudo systemctl daemon-reload
sudo mount -a
findmnt /var/lib/containerd; findmnt /var/lib/docker; findmnt /var/lib/mediforce
```

Each `findmnt` must show the volume device as its source, for example
`/dev/sdb[/docker]`.

## 7. Don't let Docker start without the volume

Hetzner's fstab line for the volume has `nofail`, and so do the bind lines
above. Without them, a volume that fails to attach would stop the server
before SSH starts. The downside of `nofail` is that containerd and Docker
would start anyway, on empty directories on root. Docker would then create a
new, **empty** Postgres volume, and production would serve an empty database.

These drop-ins keep both services down until their directories are mounted:

```bash
sudo mkdir -p /etc/systemd/system/containerd.service.d /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/var/lib/containerd\n' \
  | sudo tee /etc/systemd/system/containerd.service.d/data-volume.conf
printf '[Unit]\nRequiresMountsFor=/var/lib/containerd /var/lib/docker /var/lib/mediforce\n' \
  | sudo tee /etc/systemd/system/docker.service.d/data-volume.conf
sudo systemctl daemon-reload
```

If the volume is missing at boot, the server still comes up and SSH works.
Docker stays down until you fix the volume.

## 8. Start and verify

```bash
sudo systemctl start containerd docker
docker info --format '{{.DockerRootDir}}'     # /var/lib/docker
docker image ls | head                        # the images are still there
$COMPOSE up -d                                # starts what step 4 stopped
$COMPOSE ps
docker ps                                     # containers outside compose too
```

`$COMPOSE stop` marks the containers as stopped by hand, and
`restart: unless-stopped` respects that. Run `up -d` to start them again.
`up -d` also runs the `migrate` init container, which does nothing when no
migrations are pending.

Compare the row counts with the ones from step 3. No table may disappear and
no count may drop. Growth is expected: the `migrate` container can add new,
empty tables when the image is newer than the one you stopped, and the
model-sync cron adds rows to `model_registry_entries` once the app is up:

```bash
docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -At -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(
           format('select count(*) as c from %I.%I', table_schema, table_name),
           false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by 1" > "$V/backups/rowcounts-after.txt"
diff "$V/backups/rowcounts-before.txt" "$V/backups/rowcounts-after.txt" && echo MATCH
```

Then check in the app:

- An old run's page still lists its **Output Files**. That proves
  `/var/lib/mediforce/attachments` moved.
- A new run with a **container step** completes. That proves the
  `docker.sock` path mapping works.

## 9. Reboot once

Reboot during the window to prove the mount order works:

```bash
sudo reboot
```

After the server comes back, repeat the `findmnt` checks from step 6 and
`$COMPOSE ps` from step 8. Containers come back on their own after a reboot.
No `up -d` is needed.

## 10. Clean up after a day of normal running

Root gets its space back only when the `.old` directories are deleted. Until
then nothing large writes to root, so waiting a day is safe:

```bash
sudo rm -rf /var/lib/containerd.old /var/lib/docker.old /var/lib/mediforce.old
df -h /
```

## Rolling back

Rolling back only works **before** step 10. Anything written after step 8
(new runs, new rows) exists only on the volume and is lost when you roll
back:

```bash
$COMPOSE stop -t 60
sudo systemctl stop docker docker.socket containerd
sudo rm /etc/systemd/system/{containerd,docker}.service.d/data-volume.conf
sudo sed -i '\#^/mnt/HC_Volume_[0-9]*/\(containerd\|docker\|mediforce\) #d' /etc/fstab
sudo systemctl daemon-reload
sudo umount /var/lib/containerd /var/lib/docker /var/lib/mediforce
for d in containerd docker mediforce; do
  sudo rmdir "/var/lib/$d" && sudo mv "/var/lib/$d.old" "/var/lib/$d"
done
sudo systemctl start containerd docker
$COMPOSE up -d
```

## New server with an empty volume

If the volume is attached before Docker is installed, nothing needs copying.
Create the three directories on the volume, add the fstab lines from step 6
and the drop-ins from step 7, and run `mount -a`. Then run
`bootstrap-server.py`.
