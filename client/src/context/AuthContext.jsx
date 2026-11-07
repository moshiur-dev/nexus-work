import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAccessToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // On first load, try to restore the session from the refresh cookie
  useEffect(() => {
    api.refresh()
      .then(({ user, accessToken }) => {
        setAccessToken(accessToken);
        setUser(user);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = async (payload) => {
    const { user, accessToken } = await api.login(payload);
    setAccessToken(accessToken);
    setUser(user);
  };

  const register = async (payload) => {
    const { user, accessToken } = await api.register(payload);
    setAccessToken(accessToken);
    setUser(user);
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
