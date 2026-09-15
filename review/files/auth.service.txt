import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verify, Algorithm } from '@node-rs/argon2';
import * as jwt from 'jsonwebtoken';
import { UsersRepo } from '../data-store/repositories/users.repo';
import { LoginDto, LoginResponse } from './dto';

// Verified against this when the phone is not known, so an unknown number costs the same
// time as a wrong pin. Never matches any real pin.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c3ByaW50ZHVtbXlzYWx0$3S3lRXKMr3xqFhVQ6mB8Bx6gJ4kYQm5nCqXQ2dZ0Ypo';

// Pins are hashed with argon2id, which is what the blueprint specifies and what the
// security audit at docs/SECURITY_AUDIT.md required before a member of the public ever
// sets a password. Swapped from bcryptjs on 13 September 2026.
//
// This was a clean cut rather than a migration, because the only hashes that existed were
// seeded demo accounts. A real system with live passwords would keep reading the old format
// at login, re hash to argon2id on a correct pin, and only then drop the old library. If
// this code is ever pointed at a database that predates the swap, put that path back first.
//
// Verification is asynchronous on purpose. argon2id is deliberately slow and memory hungry,
// which is the point of it, and doing that synchronously would block every other request on
// the server for the duration of one login.
@Injectable()
export class AuthService {
  constructor(private readonly usersRepo: UsersRepo) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    if (!dto || !dto.phone || !dto.pin) {
      throw new UnauthorizedException('Phone and pin are both needed to sign in.');
    }
    const user = this.usersRepo.findByPhone(dto.phone.trim());
    // The same message and roughly the same work whether the phone is unknown or the pin is
    // wrong, so a caller cannot learn which numbers are registered by timing the answer.
    const stored = user?.pin_hash ?? DUMMY_HASH;
    let ok = false;
    try {
      ok = await verify(stored, dto.pin, { algorithm: Algorithm.Argon2id });
    } catch {
      ok = false;
    }
    if (!user || !ok) {
      throw new UnauthorizedException('That phone and pin do not match, please try again.');
    }
    const secret = process.env.JWT_SECRET as string;
    const token = jwt.sign({ sub: user.id, role: user.role, name: user.name }, secret, {
      algorithm: 'HS256',
      expiresIn: '12h',
    });
    return { token, role: user.role, name: user.name };
  }
}
