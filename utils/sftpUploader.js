import SftpClient from 'ssh2-sftp-client';
import fs from 'fs';

const sftpUploader = async (localPath, remotePath) => {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: 'secureftp.dhs.state.mn.us',
      port: 2222,
      username: process.env.SFTP_USERNAME,
      password: process.env.SFTP_PASSWORD,
      algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256'],
      },
      readyTimeout: 20000,
      strictVendor: false,
    });

    await sftp.put(localPath, `submitted/${remotePath}`);
  } finally {
    await sftp.end();
    // fs.unlinkSync(localPath); 
  }
};

export default sftpUploader;
