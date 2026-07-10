import { PrismaClient } from "@prisma/client";

/** Singleton de Prisma Client para todo el proceso del server. */
export const db = new PrismaClient();
