import { NextRequest, NextResponse } from 'next/server';
import { access } from './lib/auth';
export function proxy(request: NextRequest) {
  return access(request.headers) || NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
