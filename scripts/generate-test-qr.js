const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const otpauthUri = 'otpauth://totp/TestIssuer:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TestIssuer&algorithm=SHA1&digits=6&period=30';

const outputDir = path.join(__dirname, 'tests', 'e2e', 'fixtures');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'test-otp-qr.png');

qrcode.toFile(outputPath, otpauthUri, { width: 256, margin: 2 })
  .then(() => {
    console.log('QR code generated:', outputPath);
  })
  .catch((err) => {
    console.error('Failed to generate QR code:', err);
    process.exit(1);
  });
