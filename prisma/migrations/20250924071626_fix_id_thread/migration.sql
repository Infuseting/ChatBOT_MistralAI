/*
  Warnings:

  - You are about to drop the column `threadId` on the `Share` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `Share` DROP FOREIGN KEY `Share_threadId_fkey`;

-- AlterTable
ALTER TABLE `Share` DROP COLUMN `threadId`,
    ADD COLUMN `idThread` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Share` ADD CONSTRAINT `Share_idThread_fkey` FOREIGN KEY (`idThread`) REFERENCES `Thread`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
