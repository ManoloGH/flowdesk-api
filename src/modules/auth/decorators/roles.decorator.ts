import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// Roles: owner > admin > manager > employee
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
