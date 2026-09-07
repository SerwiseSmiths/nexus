export default async function globalTeardown() {
  // Per-suite Prisma clients disconnect in their own afterAll hooks.
}
