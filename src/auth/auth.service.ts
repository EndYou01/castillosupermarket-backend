import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService
  ) { }

  // Método para probar la conexión a la base de datos
  async testConnection() {
    try {
      const count = await this.usersService.getUserCount();
      console.log('✅ Conexión exitosa - Usuarios en DB:', count);
      return {
        success: true,
        message: 'Conexión a base de datos exitosa',
        userCount: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error de conexión:', error);
      return {
        success: false,
        message: 'Error de conexión a base de datos',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);
    if (user && await bcrypt.compare(pass, user.password)) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException();

    const payload = { username: user.username, sub: user.id };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '30d' });

    // Guarda el refresh token hasheado
    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    await this.usersService.updateRefreshToken(user.id, hashedRefresh);

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshAccessToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.refreshToken) throw new UnauthorizedException();

      const isMatch = await bcrypt.compare(refreshToken, user.refreshToken);
      if (!isMatch) throw new UnauthorizedException('Refresh token inválido');

      const newAccessToken = this.jwtService.sign({ sub: user.id, username: user.username }, { expiresIn: '15m' });

      return { accessToken: newAccessToken };
    } catch (err) {
      throw new UnauthorizedException('Token no válido o expirado');
    }
  }
}