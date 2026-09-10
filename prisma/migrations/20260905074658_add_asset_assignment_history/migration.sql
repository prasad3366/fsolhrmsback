-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" SERIAL NOT NULL,
    "assetId" INTEGER NOT NULL,
    "assignedTo" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "unassignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_unassignedAt_idx" ON "AssetAssignment"("assetId", "unassignedAt");

-- CreateIndex
CREATE INDEX "AssetAssignment_assignedTo_idx" ON "AssetAssignment"("assignedTo");

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
