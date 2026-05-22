-- CreateEnum
CREATE TYPE "SpaceType" AS ENUM ('OFFICE', 'MEETING_ROOM', 'RECEPTION', 'WAREHOUSE', 'EXTERIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CameraType" AS ENUM ('MJPEG', 'SNAPSHOT', 'RTSP', 'CLOUD');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SpaceType" NOT NULL DEFAULT 'OFFICE',
    "floor" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CameraType" NOT NULL DEFAULT 'MJPEG',
    "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "stream_url_enc" TEXT,
    "snapshot_url_enc" TEXT,
    "rtsp_url_enc" TEXT,
    "cloud_embed_url" TEXT,
    "refresh_interval_secs" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Space_tenant_id_idx" ON "Space"("tenant_id");

-- CreateIndex
CREATE INDEX "Camera_tenant_id_idx" ON "Camera"("tenant_id");

-- CreateIndex
CREATE INDEX "Camera_space_id_idx" ON "Camera"("space_id");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
