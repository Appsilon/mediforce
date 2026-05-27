import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
  type NamespaceMembership,
  type NamespaceRepository,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

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
    await this.db
      .collection(this.namespacesCollection)
      .doc(handle)
      .collection(this.membersSubcollection)
      .doc(member.uid)
      .set(member);
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
    // Two parallel sources, dedup by handle (personal wins on conflict — the
    // owner of a personal namespace always outranks any other recorded role,
    // and the same handle showing up in both queries shouldn't happen in
    // practice).
    const [memberSnapshot, personalSnapshot] = await Promise.all([
      (async () => {
        try {
          return await this.db
            .collectionGroup(this.membersSubcollection)
            .where('uid', '==', uid)
            .get();
        } catch (err: unknown) {
          const grpcErr = err as { code?: number };
          if (grpcErr.code === 9) {
            console.warn(
              '[namespace-repository] collectionGroup("members") index missing — getMembershipsForUser returning personal-only for uid:',
              uid,
            );
            return null;
          }
          throw err;
        }
      })(),
      this.db
        .collection(this.namespacesCollection)
        .where('linkedUserId', '==', uid)
        .get(),
    ]);

    const byHandle = new Map<string, NamespaceMembership>();

    if (memberSnapshot !== null) {
      for (const memberDoc of memberSnapshot.docs) {
        const namespaceRef = memberDoc.ref.parent.parent;
        if (namespaceRef === null) continue;
        const member = NamespaceMemberSchema.parse(memberDoc.data());
        byHandle.set(namespaceRef.id, { handle: namespaceRef.id, role: member.role });
      }
    }

    for (const doc of personalSnapshot.docs) {
      const ns = NamespaceSchema.parse(doc.data());
      // Personal namespace: owner regardless of any prior entry.
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
