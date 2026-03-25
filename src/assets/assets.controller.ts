import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Put,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  // 🔥 HR creates & assigns asset
  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.create(dto);
  }

  // 🔥 HR/Admin view all
  @Get()
  findAll() {
    return this.assetsService.findAll();
  }

 

  // 🔥 Employee view own assets (WITH JWT - recommended)
  @UseGuards(JwtAuthGuard)
  @Get('my-assets')
  getMyAssetsFromToken(@Req() req: any) {
    return this.assetsService.findMyAssets(req.user.id);
  }

  // 🔥 HR/Admin return asset
  @Put('return/:id')
  returnAsset(@Param('id') id: string) {
    return this.assetsService.returnAsset(Number(id));
  }
}