import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { join } from 'path';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    });


    this.transporter.verify()
      .then(() => console.log('✅ SMTP Connected'))
      .catch((err) => console.error('❌ SMTP Connection Error:', err));
  }

  // ✅ Send Employee Credentials
  async sendEmployeeCredentials(to: string, password: string, firstName: string) {
    try {
      console.log('📧 Sending credentials to:', to);

      const logoCid = 'foodeezlogo1@logo';
      const logoPath = join(process.cwd(), 'src', 'public', 'foodeezlogo1.jpeg');

const info = await this.transporter.sendMail({
  from: process.env.SMTP_EMAIL,
  to,
  subject: 'Foodeez Work Portal - Login Credentials',
   html: `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; font-size: 14px; color: #000; line-height: 1.6;">

      <div style="margin-bottom: 20px; text-align: center;">
        <img
          src="cid:${logoCid}"
          alt="Foodeez Logo"
          style="width: 100%; max-width: 640px; height: auto; display: block; margin: 0 auto;"
        />
      </div>

      <p>Hello ${firstName},</p>

      <p>Your Work Portal credentials have been created successfully.</p>

      <p><strong>Login Details:</strong></p>
      <p>
        Email: ${to}<br/>
        Password: ${password}
      </p>

      <p>You can access your account using the link below:</p>

      <p>
        <a href="https://hrms.palatenetworks.in">
          https://hrms.palatenetworks.in
        </a>
      </p>

      <p>Please log in and change your password after your first login.</p>

      <p>If you did not expect this email, please contact the HR team.</p>

      <br/>

      <p>
        Regards,<br/>
        HR Team<br/>
        Foodeez<br/>
        Palate Networks Private Limited
      </p>

      <p style="font-size: 10px; color: #000; margin-top: 20px;">
        This message contains information that may be privileged or confidential and is the property of Palate Networks Private Limited. It is intended only for the person to whom it is addressed. If you are not the intended recipient, please notify the sender and delete this message.
      </p>

    </div>
    `,
    attachments: [
      {
        filename: 'foodeezlogo1.jpeg',
        path: logoPath,
        cid: logoCid,
      },
    ],
  });

      console.log('✅ Mail Sent:', info.messageId);
      return info;

    } catch (error) {
      console.error('❌ Mail Error (Credentials):', error);
      throw new InternalServerErrorException('Failed to send employee credentials');
    }
  }

  // ✅ Send OTP
  async sendOtp(to: string, otp: string, firstName: string) {
    try {
      console.log('📧 Sending OTP to:', to);

      const logoCid = 'foodeezlogo1@logo';
      const logoPath = join(process.cwd(), 'src', 'public', 'foodeezlogo1.jpeg');

      const info = await this.transporter.sendMail({
        from: process.env.SMTP_EMAIL,
        to,
        subject: 'Your OTP for Password Reset',
        html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; font-size: 14px; color: #000; line-height: 1.6;">

        <div style="margin-bottom: 20px; text-align: center;">
          <img
            src="cid:${logoCid}"
            alt="Foodeez Logo"
            style="width: 100%; max-width: 640px; height: auto; display: block; margin: 0 auto;"
          />
        </div>

        <p>Hello ${firstName},</p>

        <p>Your OTP for password reset has been generated.</p>

        <p><strong>OTP Details:</strong></p>
        <p>
          OTP: <strong>${otp}</strong><br/>
          Valid for: 5 minutes
        </p>

        <p>You can reset your password using the link below:</p>

        <p>
          <a href="https://hrms.palatenetworks.in">
            https://hrms.palatenetworks.in
          </a>
        </p>

        <p>Please use the OTP to complete your password reset.</p>

        <p>If you did not request this, please contact the HR team.</p>

        <br/>

        <p>
          Regards,<br/>
          HR Team<br/>
          Foodeez<br/>
          Palate Networks Private Limited
        </p>

        <p style="font-size: 10px; color: #000; margin-top: 20px;">
          This message contains information that may be privileged or confidential and is the property of Palate Networks Private Limited. It is intended only for the person to whom it is addressed. If you are not the intended recipient, please notify the sender and delete this message.
        </p>

      </div>
    `,
    attachments: [
      {
        filename: 'foodeezlogo1.jpeg',
        path: logoPath,
        cid: logoCid,
      },
    ],
  });

      console.log('✅ OTP Sent:', info.messageId);
      return info;

    } catch (error) {
      console.error('❌ Mail Error (OTP):', error);
      throw new InternalServerErrorException('Failed to send OTP');
    }
  }
}