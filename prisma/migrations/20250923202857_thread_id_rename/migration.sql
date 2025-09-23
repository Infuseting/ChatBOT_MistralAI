/*
  Warnings:

  - You are about to drop the column `threadId` on the `Message` table. All the data in the column will be lost.
  - Added the required column `idThread` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `Message` DROP FOREIGN KEY `Message_threadId_fkey`;

-- AlterTable
ALTER TABLE `Message` DROP COLUMN `threadId`,
    ADD COLUMN `idThread` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_idThread_fkey` FOREIGN KEY (`idThread`) REFERENCES `Thread`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
