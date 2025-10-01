-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `extension` VARCHAR(191) NOT NULL,
    `type` ENUM('file', 'image', 'video', 'audio') NOT NULL,
    `libraryId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(256) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Data` (
    `sha256` VARCHAR(256) NOT NULL,
    `data` LONGTEXT NOT NULL,

    PRIMARY KEY (`sha256`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_sha256_fkey` FOREIGN KEY (`sha256`) REFERENCES `Data`(`sha256`) ON DELETE RESTRICT ON UPDATE CASCADE;
