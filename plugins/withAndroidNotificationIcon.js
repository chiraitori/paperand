const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidNotificationIcon = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const projectRoot = config.modRequest.projectRoot;
            const sourceFile = path.join(projectRoot, 'assets', 'notification_icon.xml');

            // Allow override locations or default
            const destDir = path.join(
                config.modRequest.platformProjectRoot,
                'app',
                'src',
                'main',
                'res',
                'drawable'
            );

            const destFile = path.join(destDir, 'ic_notification_vector.xml');

            if (fs.existsSync(sourceFile)) {
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }
                fs.copyFileSync(sourceFile, destFile);
                console.log('Copied notification_icon.xml to Android resources.');
            } else {
                console.warn('Could not find assets/notification_icon.xml to copy.');
            }

            return config;
        },
    ]);
};

module.exports = withAndroidNotificationIcon;
