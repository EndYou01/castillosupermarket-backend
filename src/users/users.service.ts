import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './users.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  // Método para contar usuarios (para test de conexión)
  async getUserCount(): Promise<number> {
    return await this.userRepository.count();
  }

  async findByUsername(username: string) {
    return this.userRepository.findOne({ where: { username } });
  }

  async findById(id: number) {
    return this.userRepository.findOne({ where: { id } });
  }

  async create(username: string, password: string) {
    const hashed = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({ username, password: hashed });
    return this.userRepository.save(user);
  }

  async updateRefreshToken(userId: number, token: string | null) {
    await this.userRepository.update(userId, { refreshToken: token });
  }
}
