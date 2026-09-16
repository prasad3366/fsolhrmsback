import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UploadedFiles,
  UseInterceptors,
  Res,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentsService } from './documents.service';
import { DocumentStatus } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('hrms')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly service: DocumentsService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private requireAuthenticatedUser(req: any) {
    const user = req?.user;

    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }

  private hasOrgWideDocumentAccess(user: any): boolean {
    return ['SUPER_ADMIN', 'CEO', 'HR'].includes(String(user?.role ?? '').toUpperCase());
  }

  private hasEmployeeDocumentReadAccess(user: any): boolean {
    return String(user?.role ?? '').toUpperCase() === 'EMPLOYEE';
  }

  private async assertSelfDocumentAccess(req: any, targetEmployeeId: number | string): Promise<void> {
    const user = this.requireAuthenticatedUser(req);

    if (this.hasOrgWideDocumentAccess(user)) {
      return;
    }

    if (String(user.role ?? '').toUpperCase() !== 'EMPLOYEE') {
      throw new ForbiddenException('Document access denied');
    }

    const selfEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(selfEmployeeId) || selfEmployeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    if (Number(targetEmployeeId) !== selfEmployeeId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async assertEmployeeDocumentAccess(
    req: any,
    targetEmployeeId: number | string,
  ): Promise<void> {
    const user = this.requireAuthenticatedUser(req);

    if (this.hasOrgWideDocumentAccess(user)) {
      return;
    }

    if (String(user.role ?? '').toUpperCase() !== 'EMPLOYEE') {
      throw new ForbiddenException('Document access denied');
    }

    const selfEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(selfEmployeeId) || selfEmployeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    if (Number(targetEmployeeId) !== selfEmployeeId) {
      throw new ForbiddenException('Access denied');
    }
  }

  // Required Documents
  @Get('required/:employeeId')
  async getRequired(@Req() req, @Param('employeeId') id: string) {
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new BadRequestException('Invalid employee id');
    }

    await this.assertSelfDocumentAccess(req, employeeId);
    return this.service.getRequiredDocuments(employeeId);
  }

  // Upload Multiple Files
  @Post('upload-multiple')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body,
    @Req() req,
  ) {
    const user = this.requireAuthenticatedUser(req);
    if (!this.hasOrgWideDocumentAccess(user)) {
      throw new ForbiddenException('Document management access denied');
    }

    const requestedEmployeeId = Number(body.employeeId);
    const targetEmployeeId = this.hasOrgWideDocumentAccess(user)
      ? requestedEmployeeId
      : Number(user.employeeId);

    if (!Number.isInteger(targetEmployeeId) || targetEmployeeId <= 0) {
      throw new BadRequestException('Employee profile required');
    }

    if (!this.hasOrgWideDocumentAccess(user)) {
      const hasAccess = await this.authorizationService.canAccessEmployee(
        user,
        targetEmployeeId,
      );

      if (!hasAccess) {
        throw new ForbiddenException('Access denied');
      }
    }

    const documentTypeIds = Array.isArray(body.documentTypeIds)
      ? body.documentTypeIds
      : body.documentTypeIds
        ? [body.documentTypeIds]
        : [];

    return this.service.uploadMultiple(
      targetEmployeeId,
      documentTypeIds,
      files,
    );
  }

  // Get Documents (Role Based)
  @Get('documents')
  async getDocuments(
    @Req() req,
    @Query('employeeId') employeeId: string,
  ) {
    const user = this.requireAuthenticatedUser(req);

    if (this.hasOrgWideDocumentAccess(user)) {
      const targetEmployeeId = Number(employeeId);
      if (targetEmployeeId && Number.isInteger(targetEmployeeId) && targetEmployeeId > 0) {
        return this.service.getDocuments(targetEmployeeId, user.role);
      }

      return this.service.getDocuments(undefined as any, user.role);
    }

    if (!this.hasEmployeeDocumentReadAccess(user)) {
      throw new ForbiddenException('Document access denied');
    }

    const selfEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(selfEmployeeId) || selfEmployeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    if (employeeId !== undefined) {
      const requestedEmployeeId = Number(employeeId);
      if (!Number.isInteger(requestedEmployeeId) || requestedEmployeeId <= 0) {
        throw new BadRequestException('Invalid employee id');
      }

      if (requestedEmployeeId !== selfEmployeeId) {
        throw new ForbiddenException('Access denied');
      }
    }

    return this.service.getDocuments(selfEmployeeId, user.role);
  }

  // Approve/Reject Single Document
  @Patch('document-status/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  updateStatus(
    @Req() req,
    @Param('id') id: string,
    @Body() body,
  ) {
    this.requireAuthenticatedUser(req);
    const status: DocumentStatus = body?.status;
    const rejectionReason = body?.remarks ?? body?.reason;
    return this.service.updateDocumentStatus(
      Number(id),
      status,
      req.user.role,
      rejectionReason,
    );
  }

  // Approve All Documents
  @Patch('approve-all/:employeeId')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  approveAll(
    @Req() req,
    @Param('employeeId') employeeId: string,
  ) {
    this.requireAuthenticatedUser(req);
    return this.service.approveAllDocuments(Number(employeeId), req.user.role);
  }

  // View File
  @Get('file/:id')
  async getFile(@Req() req, @Param('id') id: string, @Res() res: Response) {
    const documentId = Number(id);

    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new BadRequestException('Invalid document id');
    }

    const doc = await this.service.getFile(documentId);
    const user = this.requireAuthenticatedUser(req);

    if (!this.hasOrgWideDocumentAccess(user)) {
      if (!this.hasEmployeeDocumentReadAccess(user)) {
        throw new ForbiddenException('Document access denied');
      }
      await this.assertEmployeeDocumentAccess(req, doc.employeeId);
    }

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.fileName}"`,
    });

    res.send(doc.fileData);
  }
}
