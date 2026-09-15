import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { UserRecord } from '../interfaces';
import { IUsersRepo } from '../repo-interfaces';
import { blindIndex } from '../../common/aes';

@Injectable()
export class UsersRepo implements IUsersRepo {
  constructor(private readonly store: StoreService) {}

  findByPhone(phone: string): UserRecord | undefined {
    const hash = blindIndex(phone);
    return this.store.state.users.find((u) => u.phone_hash === hash);
  }
}
