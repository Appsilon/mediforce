import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

export class FirestoreNamespaceRepository {
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

  async getUserNamespaces(uid: string): Promise<Namespace[]> {
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
  }
}
