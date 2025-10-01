/*
  Warnings:

  - You are about to drop the column `attachmentId` on the `Message` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Message` DROP COLUMN `attachmentId`;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `extension` VARCHAR(191) NOT NULL,
    `type` ENUM('file', 'image', 'video', 'audio') NOT NULL,
    `librariesId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `dataId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Data` (
    `id` VARCHAR(191) NOT NULL,
    `md5` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,

    UNIQUE INDEX `Data_md5_key`(`md5`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_dataId_fkey` FOREIGN KEY (`dataId`) REFERENCES `Data`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
