-- DropIndex
DROP INDEX `Message_parentId_fkey` ON `Message`;

-- AlterTable
ALTER TABLE `Message` MODIFY `thinking` LONGTEXT NOT NULL,
    MODIFY `parentId` LONGTEXT NULL,
    MODIFY `text` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `Thread` MODIFY `name` LONGTEXT NOT NULL,
    MODIFY `context` LONGTEXT NULL,
    MODIFY `model` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `User` MODIFY `name` LONGTEXT NOT NULL,
    MODIFY `avatar` LONGTEXT NULL;
