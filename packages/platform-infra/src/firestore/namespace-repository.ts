import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
} from '@mediforce/platform-core';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

export class FirestoreNamespaceRepository {
  private readonly namespacesCollection = 'namespaces';
  private readonly membersSubcollection = 'members';

  constructor(private readonly db: Firestore) {}

  async getNamespace(handle: string): Promise<Namespace | null> {
    const docRef = doc(this.db, this.namespacesCollection, handle);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    return NamespaceSchema.parse(snapshot.data());
  }

  async createNamespace(namespace: Namespace): Promise<void> {
    const docRef = doc(this.db, this.namespacesCollection, namespace.handle);
    await setDoc(docRef, namespace);
  }

  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    const docRef = doc(this.db, this.namespacesCollection, handle);
    await updateDoc(docRef, updates);
  }

  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    // Query personal namespaces linked to this user
    const personalQuery = query(
      collection(this.db, this.namespacesCollection),
      where('linkedUserId', '==', uid),
    );
    const personalSnapshot = await getDocs(personalQuery);
    const personalNamespaces = personalSnapshot.docs.map((d) =>
      NamespaceSchema.parse(d.data()),
    );

    // Query namespaces where user is a member via collectionGroup
    const memberNamespaces = await this.getUserNamespaces(uid);

    // Merge, deduplicate by handle
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
    const docRef = doc(
      this.db,
      this.namespacesCollection,
      handle,
      this.membersSubcollection,
      member.uid,
    );
    await setDoc(docRef, member);
  }

  async removeMember(handle: string, uid: string): Promise<void> {
    const docRef = doc(
      this.db,
      this.namespacesCollection,
      handle,
      this.membersSubcollection,
      uid,
    );
    await deleteDoc(docRef);
  }

  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    const docRef = doc(
      this.db,
      this.namespacesCollection,
      handle,
      this.membersSubcollection,
      uid,
    );
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    return NamespaceMemberSchema.parse(snapshot.data());
  }

  async getMembers(handle: string): Promise<NamespaceMember[]> {
    const colRef = collection(
      this.db,
      this.namespacesCollection,
      handle,
      this.membersSubcollection,
    );
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map((d) => NamespaceMemberSchema.parse(d.data()));
  }

  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    // Query the members subcollection across all namespaces via collectionGroup
    const memberQuery = query(
      collectionGroup(this.db, this.membersSubcollection),
      where('uid', '==', uid),
    );
    const memberSnapshot = await getDocs(memberQuery);

    const namespaces = await Promise.all(
      memberSnapshot.docs.map(async (memberDoc) => {
        // Parent of members subcollection doc is the namespace doc
        const namespaceRef = memberDoc.ref.parent.parent;
        if (namespaceRef === null) return null;
        const namespaceSnapshot = await getDoc(namespaceRef);
        if (!namespaceSnapshot.exists()) return null;
        return NamespaceSchema.parse(namespaceSnapshot.data());
      }),
    );

    return namespaces.filter((ns): ns is Namespace => ns !== null);
  }
}
