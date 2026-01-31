import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  // host: 'smtp.gmail.com',
  // port: 465,
  // secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const generateEmailHtml = (email, verificationCode) => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>CareAutomate OTP Verification</title>
    <style>
      body {
        background-color: #181A2A;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 0;
        color: #333;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background: #fff;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
      }
      .header {
        background-color: #fff;
        padding: 24px 32px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid #eee;
      }
      .logo {
        height: 48px;
        margin-right: 16px;
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        color: #181A2A;
      }
      .body {
        padding: 32px;
      }
      .greeting {
        font-size: 18px;
        margin-bottom: 16px;
        font-weight: 500;
        color: #181A2A;
      }
      .otp-box {
        background: #f0f3ff;
        border: 2px dashed #6F84F8;
        padding: 20px;
        text-align: center;
        font-size: 28px;
        font-weight: bold;
        color: #6F84F8;
        border-radius: 8px;
        letter-spacing: 4px;
        margin: 20px 0;
      }
      .info {
        font-size: 15px;
        line-height: 1.6;
        color: #555;
        margin-bottom: 20px;
      }
      .footer {
        background-color: #f9f9f9;
        text-align: center;
        padding: 16px;
        font-size: 12px;
        color: #999;
        border-top: 1px solid #eee;
      }

      @media (max-width: 600px) {
        .container {
          margin: 20px;
        }
        .header {
          flex-direction: column;
          align-items: flex-start;
        }
        .title {
          margin-top: 10px;
          font-size: 18px;
        }
        .otp-box {
          font-size: 22px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://demo.careautomate.com/careAutomate.png" alt="CareAutomate Logo" class="logo" />
        <div class="title">CareAutomate Verification</div>
      </div>
      <div class="body">
        <p class="greeting">Hello ${email},</p>
        <p>Use the OTP code below to verify your email address:</p>
        <div class="otp-box">${verificationCode}</div>
        <p class="info">
          This OTP is valid for only <strong>10 minutes</strong>. Please don’t share it with anyone.
          <br /><br />
          If you didn’t request this, you can safely ignore this email.
        </p>
      </div>
      <div class="footer">
        &copy; 2025 CareAutomate. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;

export const sendVerificationEmail = async (email, verificationCode) => {
  const htmlContent = generateEmailHtml(email, verificationCode);
  const mailOptions = {
    from: `"CareAutomate" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Your OTP Code - CareAutomate',
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
};
