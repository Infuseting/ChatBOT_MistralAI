-- DropForeignKey
ALTER TABLE `Message` DROP FOREIGN KEY `Message_idThread_fkey`;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_idThread_fkey` FOREIGN KEY (`idThread`) REFERENCES `Thread`(`idThread`) ON DELETE RESTRICT ON UPDATE CASCADE;
