import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
  type NamespaceMembership,
  type NamespaceRepository,
} from '@mediforce/platform-core';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export class FirestoreNamespaceRepository implements NamespaceRepository {
  private readonly namespacesCollection = 'namespaces';
  private readonly membersSubcollection = 'members';

  constructor(private readonly db: Firestore) {}

  async getNamespace(handle: string): Promise<Namespace | null> {
    const snapshot = await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .get();
    if (!snapshot.exists) return null;
    return NamespaceSchema.parse(snapshot.data());
  }

  async createNamespace(namespace: Namespace): Promise<void> {
    await this.db
      .collection(this.namespacesCollection)
      .doc(namespace.handle)
      .set(namespace);
  }

  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .update(updates);
  }

  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    const personalSnapshot = await this.db
      .collection(this.namespacesCollection)
      .where('linkedUserId', '==', uid)
      .get();
    const personalNamespaces = personalSnapshot.docs.map((d) =>
      NamespaceSchema.parse(d.data()),
    );

    const memberNamespaces = await this.getUserNamespaces(uid);

    const handlesSeen = new Set<string>(personalNamespaces.map((n) => n.handle));
    const merged = [...personalNamespaces];
    for (const ns of memberNamespaces) {
      if (!handlesSeen.has(ns.handle)) {
        handlesSeen.add(ns.handle);
        merged.push(ns);
      }
    }

    return merged;
  }

  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    // Two writes: the member doc (subcollection) plus a denormalized
    // `users/{uid}.organizations` arrayUnion entry. The user-doc field is the
    // primary read path for `getUserNamespaces` (single-doc read, no
    // collectionGroup index needed); keep it consistent with the member
    // subcollection here so a new member is reachable via both paths.
    await Promise.all([
      this.db
        .collection(this.namespacesCollection)
        .doc(handle)
        .collection(this.membersSubcollection)
        .doc(member.uid)
        .set(member),
      this.db
        .collection('users')
        .doc(member.uid)
        .set({ organizations: FieldValue.arrayUnion(handle) }, { merge: true }),
    ]);
  }

  async removeMember(handle: string, uid: string): Promise<void> {
    await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .collection(this.membersSubcollection)
      .doc(uid)
      .delete();
  }

  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    const snapshot = await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .collection(this.membersSubcollection)
      .doc(uid)
      .get();
    if (!snapshot.exists) return null;
    return NamespaceMemberSchema.parse(snapshot.data());
  }

  async getMembers(handle: string): Promise<NamespaceMember[]> {
    const snapshot = await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .collection(this.membersSubcollection)
      .get();
    return snapshot.docs.map((d) => NamespaceMemberSchema.parse(d.data()));
  }

  async getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]> {
    // Primary path mirrors `getUserNamespaces`: single doc read on
    // `users/{uid}.organizations`, then per-handle fetch of the member doc to
    // get the role. Avoids requiring the `members` collectionGroup index in
    // dev/emulator environments. Falls back to collectionGroup when the
    // organizations array is empty/missing.
    const [userDoc, personalSnapshot] = await Promise.all([
      this.db.collection('users').doc(uid).get(),
      this.db
        .collection(this.namespacesCollection)
        .where('linkedUserId', '==', uid)
        .get(),
    ]);

    const byHandle = new Map<string, NamespaceMembership>();

    const organizations = userDoc.exists ? (userDoc.data()?.organizations as unknown) : undefined;
    if (Array.isArray(organizations) && organizations.length > 0) {
      const memberships = await Promise.all(
        organizations.map(async (handle: string) => {
          const memberSnap = await this.db
            .collection(this.namespacesCollection).doc(handle)
            .collection(this.membersSubcollection).doc(uid)
            .get();
          if (!memberSnap.exists) return null;
          const member = NamespaceMemberSchema.parse(memberSnap.data());
          return { handle, role: member.role } satisfies NamespaceMembership;
        }),
      );
      for (const m of memberships) {
        if (m !== null) byHandle.set(m.handle, m);
      }
    } else {
      // Fallback: collectionGroup query (requires deployed
      // `members.uid ASCENDING` index). Surfaces a console warning when the
      // index is missing rather than silently returning personal-only.
      try {
        const memberSnapshot = await this.db
          .collectionGroup(this.membersSubcollection)
          .where('uid', '==', uid)
          .get();
        for (const memberDoc of memberSnapshot.docs) {
          const namespaceRef = memberDoc.ref.parent.parent;
          if (namespaceRef === null) continue;
          const member = NamespaceMemberSchema.parse(memberDoc.data());
          byHandle.set(namespaceRef.id, { handle: namespaceRef.id, role: member.role });
        }
      } catch (err: unknown) {
        const grpcErr = err as { code?: number };
        if (grpcErr.code !== 9) throw err;
        console.warn(
          '[namespace-repository] collectionGroup("members") index missing and users/%s.organizations empty — returning personal-only',
          uid,
        );
      }
    }

    // Personal namespaces (linkedUserId match) — owner wins over any prior entry.
    for (const doc of personalSnapshot.docs) {
      const ns = NamespaceSchema.parse(doc.data());
      byHandle.set(ns.handle, { handle: ns.handle, role: 'owner' });
    }

    return [...byHandle.values()];
  }

  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    // Primary path: read organizations array from user doc (single doc read,
    // no collectionGroup index needed). Falls back to collectionGroup query
    // if user doc doesn't exist or has no organizations field.
    const userDoc = await this.db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const orgs = userDoc.data()?.organizations;
      if (Array.isArray(orgs) && orgs.length > 0) {
        const namespaces = await Promise.all(
          orgs.map(async (handle: string) => {
            const nsDoc = await this.db.collection(this.namespacesCollection).doc(handle).get();
            if (!nsDoc.exists) return null;
            return NamespaceSchema.parse(nsDoc.data());
          }),
        );
        return namespaces.filter((ns): ns is Namespace => ns !== null);
      }
    }

    // Fallback: collectionGroup query (requires single-field index on
    // members.uid with COLLECTION_GROUP scope).
    try {
      const memberSnapshot = await this.db
        .collectionGroup(this.membersSubcollection)
        .where('uid', '==', uid)
        .get();

      const namespaces = await Promise.all(
        memberSnapshot.docs.map(async (memberDoc) => {
          const namespaceRef = memberDoc.ref.parent.parent;
          if (namespaceRef === null) return null;
          const namespaceSnapshot = await namespaceRef.get();
          if (!namespaceSnapshot.exists) return null;
          return NamespaceSchema.parse(namespaceSnapshot.data());
        }),
      );

      return namespaces.filter((ns): ns is Namespace => ns !== null);
    } catch (err: unknown) {
      const grpcErr = err as { code?: number };
      if (grpcErr.code === 9) {
        console.warn('[namespace-repository] collectionGroup("members") index missing — falling back to empty org list for uid:', uid);
        return [];
      }
      throw err;
    }
  }
}
