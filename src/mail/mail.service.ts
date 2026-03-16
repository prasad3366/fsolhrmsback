import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {

  private transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  async sendEmployeeCredentials(
    to: string,
    password: string,
  ) {
    await this.transporter.sendMail({
      from: `"HR Portal" <${process.env.SMTP_EMAIL}>`,
      to,
      subject: 'Your Employee Account Created',
      html: `
        <h3>Welcome to Company</h3>

        <p>Your employee account has been created.</p>

        <p><strong>Email:</strong> ${to}</p>
        <p><strong>Password:</strong> ${password}</p>

        <p>Please login and change your password.</p>
      `,
    });
  }

  async sendOtp(to: string, otp: string) {
    await this.transporter.sendMail({
      from: `"HR Portal" <${process.env.SMTP_EMAIL}>`,
      to,
      subject: 'Your OTP for Password Reset',
      html: `
        <h3>Password Reset OTP</h3>
        <p>Your OTP for password reset is: <strong>${otp}</strong></p>
        <p>This OTP is valid for 5 minutes.</p>
      `,
    });
  }
}