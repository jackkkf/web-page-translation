import { useCallback, useEffect, useState } from 'react';
import {
  credentialsStorage,
  loadCredentials,
  loadSettings,
  patchSettings,
  settingsStorage,
  type EngineCredentials,
  type Settings,
} from '../core/settings';

/**
 * 读写全局设置。
 * 直接订阅 storage 而不是走消息通道，popup 与选项页因此天然保持同步。
 */
export function useSettings(): {
  settings: Settings | null;
  update: (patch: Partial<Settings>) => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings().then((value) => {
      if (active) setSettings(value);
    });
    const unwatch = settingsStorage.watch((value) => {
      if (active && value) setSettings(value);
    });
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await patchSettings(patch);
    setSettings(next);
  }, []);

  return { settings, update };
}

export function useCredentials(): {
  credentials: EngineCredentials | null;
  update: (patch: EngineCredentials) => Promise<void>;
} {
  const [credentials, setCredentials] = useState<EngineCredentials | null>(null);

  useEffect(() => {
    let active = true;
    void loadCredentials().then((value) => {
      if (active) setCredentials(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (patch: EngineCredentials) => {
    const current = await loadCredentials();
    const next = { ...current, ...patch };
    await credentialsStorage.setValue(next);
    setCredentials(next);
  }, []);

  return { credentials, update };
}
