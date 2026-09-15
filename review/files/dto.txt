export interface LoginDto {
  phone: string;
  pin: string;
}

export interface LoginResponse {
  token: string;
  role: string;
  name: string;
}
