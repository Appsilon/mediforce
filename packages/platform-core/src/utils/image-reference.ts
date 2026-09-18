/**
 * Docker image reference grammar, as the Image Catalog reads it (ADR-0022).
 *
 * One set of pieces, so the upload name, the pull reference and the image a
 * worker pulls are three compositions of the same grammar rather than three
 * regexes that can drift apart.
 */

/** One lowercase path component: `r-ver`, `sdtm_agent`. */
const PATH_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
/** `acme/agent`, `rocker/r-ver` — no registry host, no tag. */
const REPOSITORY_PATH = `${PATH_COMPONENT}(?:/${PATH_COMPONENT})*`;
/** One hostname label: alphanumeric ends, hyphens only inside. */
const HOST_LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?';
/** `ghcr.io`, `localhost:5000`. Dotted labels and an optional port, so a
 *  malformed host (`./x`, `foo..bar`) is a 400 here rather than a failed
 *  `docker pull` reported as an internal error. */
const REGISTRY_HOST = `${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::[0-9]{1,5})?`;
const TAG = '[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}';

/** A repository path with no host or tag — what an upload or publish names. */
export const DOCKER_REPOSITORY_PATTERN = new RegExp(`^${REPOSITORY_PATH}$`);
export const DOCKER_TAG_PATTERN = new RegExp(`^${TAG}$`);
/** A registry image with no tag or digest — what a pull names. */
export const PULL_REFERENCE_PATTERN = new RegExp(`^(?:${REGISTRY_HOST}/)?${REPOSITORY_PATH}$`);
/** `reference:tag` — what the worker pulls. Never a leading `-`, so it can
 *  never be read as a `docker pull` flag. */
export const PULL_IMAGE_PATTERN = new RegExp(`^(?:${REGISTRY_HOST}/)?${REPOSITORY_PATH}:${TAG}$`);

const DOCKER_HUB_HOSTS = ['docker.io/', 'index.docker.io/', 'registry-1.docker.io/'];

/**
 * Whether a reference's first path segment names a registry host rather than a
 * user or an organization: it has a dot or a port, or is `localhost` — Docker's
 * own rule. A workspace handle has none of these.
 */
export function isRegistryHost(segment: string): boolean {
  return segment.includes('.') || segment.includes(':') || segment === 'localhost';
}

/**
 * The repository name the daemon lists a pulled image under. Docker Hub's host
 * and its `library/` prefix are dropped — `docker.io/library/python` and
 * `library/python` are both listed as `python` — and a `referenced` entry
 * resolves its versions by that listing, so any other spelling would leave the
 * entry with none.
 */
export function daemonRepositoryName(reference: string): string {
  const host = DOCKER_HUB_HOSTS.find((candidate) => reference.startsWith(candidate));
  const path = host === undefined ? reference : reference.slice(host.length);
  const [first] = path.split('/');
  if (host === undefined && first !== undefined && isRegistryHost(first)) return reference;
  return path.startsWith('library/') ? path.slice('library/'.length) : path;
}

/**
 * A reference with its tag dropped — `python:3.12-slim` is `python`,
 * `localhost:5000/agent:1` is `localhost:5000/agent`. A colon followed by a
 * `/` is a registry port, not a tag, which is the whole reason this is not a
 * `split(':')[0]`.
 */
export function untaggedReference(reference: string): string {
  const lastColon = reference.lastIndexOf(':');
  if (lastColon === -1 || reference.includes('/', lastColon)) return reference;
  return reference.slice(0, lastColon);
}
