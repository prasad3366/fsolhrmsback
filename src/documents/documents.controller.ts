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
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentsService } from './documents.service';
import { DocumentStatus } from '@prisma/client';
import type { Response } from 'express';

@Controller('hrms')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // Create Employee
  @Post('employee')
  createEmployee(@Body() body) {
    return this.service.createEmployee(body);
  }

  // Required Documents
  @Get('required/:employeeId')
  getRequired(@Param('employeeId') id: string) {
    return this.service.getRequiredDocuments(+id);
  }

  // Upload Multiple Files
  @Post('upload-multiple')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadMultiple(@UploadedFiles() files: Express.Multer.File[], @Body() body) {
    return this.service.uploadMultiple(
      Number(body.employeeId),
      body.documentTypeIds,
      files,
    );
  }

  // Get Documents (Role Based)
  @Get('documents')
  getDocuments(
    @Query('employeeId') employeeId: string,
    @Query('role') role: string,
  ) {
    return this.service.getDocuments(Number(employeeId), role);
  }

  // Approve/Reject Single Document
  @Patch('document-status/:id')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: DocumentStatus,
    @Body('role') role: string,
  ) {
    return this.service.updateDocumentStatus(Number(id), status, role);
  }

  // Approve All Documents
  @Patch('approve-all/:employeeId')
  approveAll(
    @Param('employeeId') employeeId: string,
    @Body('role') role: string,
  ) {
    return this.service.approveAllDocuments(Number(employeeId), role);
  }

  // View File
  @Get('file/:id')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.service.getFile(+id);

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.fileName}"`,
    });

    res.send(doc.fileData);
  }
}
