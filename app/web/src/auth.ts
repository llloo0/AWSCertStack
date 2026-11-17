import { Amplify } from 'aws-amplify';
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from 'aws-amplify/auth';
import type { AppConfig } from './types';

export function configureAuth(config: AppConfig): void {
  if (!config.userPoolId || !config.userPoolClientId) {
    throw new Error('Cognito 未配置：config.json 里缺少 userPoolId / userPoolClientId');
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { username: true },
      },
    },
  });
}

export async function getSessionUser(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.username;
  } catch {
    return null;
  }
}

export interface SignInResult {
  signedIn: boolean;
  needsNewPassword?: boolean;
}

export async function signInWithPassword(username: string, password: string): Promise<SignInResult> {
  const result = await signIn({ username, password });
  if (result.isSignedIn) return { signedIn: true };
  if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
    return { signedIn: false, needsNewPassword: true };
  }
  throw new Error(`登录需要额外步骤：${result.nextStep?.signInStep ?? 'unknown'}`);
}

export async function setNewPassword(newPassword: string): Promise<void> {
  const result = await confirmSignIn({ challengeResponse: newPassword });
  if (!result.isSignedIn) throw new Error('修改密码后仍未登录，请重试');
}

export async function getIdToken(): Promise<string | null> {
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString() ?? null;
}

export async function signOutCurrent(): Promise<void> {
  await signOut();
}
