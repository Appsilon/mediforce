import { createTestUser } from '../e2e/helpers/emulator';
import {
  seedPostgresOrganizationNamespace,
  seedPostgresWorkspaceMember,
} from '../e2e/helpers/postgres-seed';
import { TEST_USER_ID } from '../e2e/helpers/constants';

const HANDLE = 'roles-demo';

async function main() {
  const alice = await createTestUser('alice@mediforce.dev', 'alice123456', 'Alice');
  const bob = await createTestUser('bob@mediforce.dev', 'bob123456', 'Bob');
  await seedPostgresOrganizationNamespace(HANDLE, TEST_USER_ID, 'Roles Demo');
  await seedPostgresWorkspaceMember(HANDLE, alice, 'member', 'Alice');
  await seedPostgresWorkspaceMember(HANDLE, bob, 'member', 'Bob');
  console.log(`/${HANDLE}: owner test@mediforce.dev, members Alice + Bob`);
}

main();
