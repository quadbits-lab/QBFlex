// packages/contracts/src/index.ts
class QBError extends Error {
  code;
  status;
  retryable;
  details;
  constructor(code, message, status = 400, retryable = false, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
    this.name = "QBError";
  }
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/package.mjs
var version = "1.7.13";

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/version.mjs
var PACKAGE_VERSION = version;

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/broadcast-channel.mjs
var kBroadcastChannel = Symbol.for("better-auth:broadcast-channel");
var now = () => Math.floor(Date.now() / 1000);
var WindowBroadcastChannel = class {
  listeners = /* @__PURE__ */ new Set;
  name;
  constructor(name = "better-auth.message") {
    this.name = name;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  post(message) {
    if (typeof window === "undefined")
      return;
    try {
      localStorage.setItem(this.name, JSON.stringify({
        ...message,
        timestamp: now()
      }));
    } catch {}
  }
  setup() {
    if (typeof window === "undefined" || typeof window.addEventListener === "undefined")
      return () => {};
    const handler = (event) => {
      if (event.key !== this.name)
        return;
      const message = JSON.parse(event.newValue ?? "{}");
      if (message?.event !== "session" || !message?.data)
        return;
      this.listeners.forEach((listener) => listener(message));
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }
};
function getGlobalBroadcastChannel(name = "better-auth.message") {
  if (!globalThis[kBroadcastChannel])
    globalThis[kBroadcastChannel] = new WindowBroadcastChannel(name);
  return globalThis[kBroadcastChannel];
}

// node_modules/.bun/nanostores@1.5.5/node_modules/nanostores/clean-stores/index.js
var clean = Symbol("clean");

// node_modules/.bun/nanostores@1.5.5/node_modules/nanostores/atom/index.js
var listenerQueue = [];
var lqIndex = 0;
var batchSeen = null;
var QUEUE_ITEMS_PER_LISTENER = 4;
var nanostoresGlobal = globalThis.nanostoresGlobal ||= { epoch: 0 };
var drainQueue = () => {
  let thrown;
  let i;
  while (lqIndex < listenerQueue.length) {
    i = lqIndex;
    lqIndex += QUEUE_ITEMS_PER_LISTENER;
    let pendingStores = batchSeen?.get(listenerQueue[i]);
    if (pendingStores) {
      if (!pendingStores.has(listenerQueue[i + 1]))
        continue;
      pendingStores.clear();
    }
    try {
      listenerQueue[i](listenerQueue[i + 1].value, listenerQueue[i + 2], listenerQueue[i + 3]);
    } catch (e) {
      thrown = e;
    }
  }
  listenerQueue.length = lqIndex = 0;
  if (thrown)
    throw thrown;
};
var atom = (initialValue) => {
  let listeners = [];
  let $atom = {
    eq: Object.is,
    get() {
      if (!$atom.lc) {
        $atom.listen(() => {})();
      }
      return $atom.value;
    },
    init: initialValue,
    lc: 0,
    listen(listener) {
      $atom.lc = listeners.push(listener);
      return () => {
        batchSeen?.get(listener)?.delete($atom);
        for (let i = lqIndex;i < listenerQueue.length; ) {
          if (listenerQueue[i] === listener && listenerQueue[i + 1] === $atom) {
            listenerQueue.splice(i, QUEUE_ITEMS_PER_LISTENER);
          } else {
            i += QUEUE_ITEMS_PER_LISTENER;
          }
        }
        let index = listeners.indexOf(listener);
        if (~index) {
          listeners.splice(index, 1);
          if (!--$atom.lc)
            $atom.off();
        }
      };
    },
    notify(oldValue, changedKey) {
      nanostoresGlobal.epoch++;
      let runListenerQueue = !listenerQueue.length && !batchSeen;
      for (let listener of listeners) {
        if (batchSeen) {
          let pendingStores = batchSeen.get(listener);
          if (!pendingStores) {
            batchSeen.set(listener, pendingStores = new Set);
          }
          if (pendingStores.has($atom))
            continue;
          pendingStores.add($atom);
        }
        listenerQueue.push(listener, $atom, oldValue, batchSeen ? undefined : changedKey);
      }
      if (runListenerQueue) {
        drainQueue();
      }
    },
    off() {},
    set(newValue) {
      let oldValue = $atom.value;
      if (!$atom.eq(oldValue, newValue)) {
        $atom.value = newValue;
        $atom.notify(oldValue);
      }
    },
    subscribe(listener) {
      let unbind = $atom.listen(listener);
      listener($atom.value);
      return unbind;
    },
    value: initialValue
  };
  if (true) {
    $atom[clean] = () => {
      listeners = [];
      $atom.lc = 0;
      $atom.off();
    };
  }
  return $atom;
};
// node_modules/.bun/nanostores@1.5.5/node_modules/nanostores/lifecycle/index.js
var SET = 2;
var MOUNT = 5;
var UNMOUNT = 6;
var REVERT_MUTATION = 10;
var on = (object, listener, eventKey, mutateStore) => {
  object.events = object.events || {};
  if (!object.events[eventKey + REVERT_MUTATION]) {
    object.events[eventKey + REVERT_MUTATION] = mutateStore((eventProps) => {
      object.events[eventKey].reduceRight((event, l) => (l(event), event), {
        shared: {},
        ...eventProps
      });
    });
  }
  object.events[eventKey] = object.events[eventKey] || [];
  object.events[eventKey].push(listener);
  return () => {
    let currentListeners = object.events[eventKey];
    let index = currentListeners.indexOf(listener);
    if (~index) {
      currentListeners.splice(index, 1);
      if (!currentListeners.length) {
        object.events[eventKey + REVERT_MUTATION]();
        delete object.events[eventKey + REVERT_MUTATION];
      }
    }
  };
};
var onSet = ($store, listener) => on($store, listener, SET, (runListeners) => {
  let originSet = $store.set;
  let originSetKey = $store.setKey;
  if ($store.setKey) {
    $store.setKey = (changed, changedValue) => {
      let isAborted;
      let abort = () => {
        isAborted = true;
      };
      runListeners({
        abort,
        changed,
        newValue: { ...$store.value, [changed]: changedValue }
      });
      if (!isAborted)
        return originSetKey(changed, changedValue);
    };
  }
  $store.set = (newValue) => {
    let isAborted;
    let abort = () => {
      isAborted = true;
    };
    runListeners({ abort, newValue });
    if (!isAborted)
      return originSet(newValue);
  };
  return () => {
    $store.set = originSet;
    $store.setKey = originSetKey;
  };
});
var STORE_UNMOUNT_DELAY = 1000;
var onMount = ($store, initialize) => {
  let listener = (payload) => {
    let destroy = initialize(payload);
    if (destroy)
      $store.events[UNMOUNT].push(destroy);
  };
  return on($store, listener, MOUNT, (runListeners) => {
    let originListen = $store.listen;
    $store.listen = (...args) => {
      if (!$store.lc && !$store.active) {
        $store.active = true;
        runListeners();
      }
      return originListen(...args);
    };
    let originOff = $store.off;
    $store.events[UNMOUNT] = [];
    $store.off = () => {
      originOff();
      setTimeout(() => {
        if ($store.active && !$store.lc) {
          $store.active = false;
          for (let destroy of $store.events[UNMOUNT])
            destroy();
          $store.events[UNMOUNT] = [];
        }
      }, STORE_UNMOUNT_DELAY);
    };
    if (true) {
      let originClean = $store[clean];
      $store[clean] = () => {
        for (let destroy of $store.events[UNMOUNT])
          destroy();
        $store.events[UNMOUNT] = [];
        $store.active = false;
        originClean();
      };
    }
    return () => {
      $store.listen = originListen;
      $store.off = originOff;
    };
  });
};
// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/equality.mjs
function isPlainObject(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isJsonEqual(a, b) {
  if (a === b)
    return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return false;
    for (let i = 0;i < a.length; i++)
      if (!isJsonEqual(a[i], b[i]))
        return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length)
      return false;
    for (const key of keysA)
      if (!(key in b) || !isJsonEqual(a[key], b[key]))
        return false;
    return true;
  }
  return false;
}
function withEquality(store, isEqual) {
  return onSet(store, ({ newValue, abort }) => {
    if (isEqual(store.value, newValue))
      abort();
  });
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/focus-manager.mjs
var kFocusManager = Symbol.for("better-auth:focus-manager");
var WindowFocusManager = class {
  listeners = /* @__PURE__ */ new Set;
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setFocused(focused) {
    this.listeners.forEach((listener) => listener(focused));
  }
  setup() {
    if (typeof window === "undefined" || typeof document === "undefined" || typeof window.addEventListener === "undefined")
      return () => {};
    const visibilityHandler = () => {
      if (document.visibilityState === "visible")
        this.setFocused(true);
    };
    document.addEventListener("visibilitychange", visibilityHandler, false);
    return () => {
      document.removeEventListener("visibilitychange", visibilityHandler, false);
    };
  }
};
function getGlobalFocusManager() {
  if (!globalThis[kFocusManager])
    globalThis[kFocusManager] = new WindowFocusManager;
  return globalThis[kFocusManager];
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/online-manager.mjs
var kOnlineManager = Symbol.for("better-auth:online-manager");
var WindowOnlineManager = class {
  listeners = /* @__PURE__ */ new Set;
  isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setOnline(online) {
    this.isOnline = online;
    this.listeners.forEach((listener) => listener(online));
  }
  setup() {
    if (typeof window === "undefined" || typeof window.addEventListener === "undefined")
      return () => {};
    const onOnline = () => this.setOnline(true);
    const onOffline = () => this.setOnline(false);
    window.addEventListener("online", onOnline, false);
    window.addEventListener("offline", onOffline, false);
    return () => {
      window.removeEventListener("online", onOnline, false);
      window.removeEventListener("offline", onOffline, false);
    };
  }
};
function getGlobalOnlineManager() {
  if (!globalThis[kOnlineManager])
    globalThis[kOnlineManager] = new WindowOnlineManager;
  return globalThis[kOnlineManager];
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/parser.mjs
var PROTO_POLLUTION_PATTERNS = {
  proto: /"(?:_|\\u0{2}5[Ff]){2}(?:p|\\u0{2}70)(?:r|\\u0{2}72)(?:o|\\u0{2}6[Ff])(?:t|\\u0{2}74)(?:o|\\u0{2}6[Ff])(?:_|\\u0{2}5[Ff]){2}"\s*:/,
  constructor: /"(?:c|\\u0063)(?:o|\\u006[Ff])(?:n|\\u006[Ee])(?:s|\\u0073)(?:t|\\u0074)(?:r|\\u0072)(?:u|\\u0075)(?:c|\\u0063)(?:t|\\u0074)(?:o|\\u006[Ff])(?:r|\\u0072)"\s*:/,
  protoShort: /"__proto__"\s*:/,
  constructorShort: /"constructor"\s*:/
};
var JSON_SIGNATURE = /^\s*["[{]|^\s*-?\d{1,16}(\.\d{1,17})?([Ee][+-]?\d+)?\s*$/;
var SPECIAL_VALUES = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  nan: NaN,
  infinity: Number.POSITIVE_INFINITY,
  "-infinity": Number.NEGATIVE_INFINITY
};
var ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
function isValidDate(date) {
  return date instanceof Date && !isNaN(date.getTime());
}
function parseISODate(value) {
  const match = ISO_DATE_REGEX.exec(value);
  if (!match)
    return null;
  const [, year, month, day, hour, minute, second, ms, offsetSign, offsetHour, offsetMinute] = match;
  const date = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hour, 10), parseInt(minute, 10), parseInt(second, 10), ms ? parseInt(ms.padEnd(3, "0"), 10) : 0));
  if (offsetSign) {
    const offset = (parseInt(offsetHour, 10) * 60 + parseInt(offsetMinute, 10)) * (offsetSign === "+" ? -1 : 1);
    date.setUTCMinutes(date.getUTCMinutes() + offset);
  }
  return isValidDate(date) ? date : null;
}
function betterJSONParse(value, options = {}) {
  const { strict = false, warnings = false, reviver, parseDates = true } = options;
  if (typeof value !== "string")
    return value;
  const trimmed = value.trim();
  const lowerValue = trimmed.toLowerCase();
  if (lowerValue.length <= 9 && lowerValue in SPECIAL_VALUES)
    return SPECIAL_VALUES[lowerValue];
  if (!JSON_SIGNATURE.test(trimmed)) {
    if (strict)
      throw new SyntaxError("[better-json] Invalid JSON");
    return value;
  }
  if (Object.entries(PROTO_POLLUTION_PATTERNS).some(([key, pattern]) => {
    const matches = pattern.test(trimmed);
    if (matches && warnings)
      console.warn(`[better-json] Detected potential prototype pollution attempt using ${key} pattern`);
    return matches;
  }) && strict)
    throw new Error("[better-json] Potential prototype pollution attempt detected");
  try {
    const secureReviver = (key, value) => {
      if (key === "__proto__" || key === "constructor" && value && typeof value === "object" && "prototype" in value) {
        if (warnings)
          console.warn(`[better-json] Dropping "${key}" key to prevent prototype pollution`);
        return;
      }
      if (parseDates && typeof value === "string") {
        const date = parseISODate(value);
        if (date)
          return date;
      }
      return reviver ? reviver(key, value) : value;
    };
    return JSON.parse(trimmed, secureReviver);
  } catch (error) {
    if (strict)
      throw error;
    return value;
  }
}
function parseJSON(value, options = { strict: true }) {
  return betterJSONParse(value, options);
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/query-atom.mjs
var kAuthQuery = Symbol.for("better-auth:auth-query");
function createAuthQueryAtom(initialValue) {
  const queryAtom = atom(initialValue);
  Object.defineProperty(queryAtom, kAuthQuery, { value: true });
  return queryAtom;
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/query.mjs
var isServer = () => typeof window === "undefined";
function isAuthQueryStateEqual(a, b) {
  return isJsonEqual(a.data, b.data) && a.error === b.error && a.isPending === b.isPending && a.isRefetching === b.isRefetching && a.refetch === b.refetch;
}
var useAuthQuery = (initializedAtom, path, $fetch, options) => {
  const value = createAuthQueryAtom({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: (queryParams) => fn(queryParams)
  });
  onMount(value, () => withEquality(value, isAuthQueryStateEqual));
  let latestRequestId = 0;
  const fn = async (queryParams) => {
    const requestId = ++latestRequestId;
    return new Promise((resolve) => {
      const opts = typeof options === "function" ? options({
        data: value.get().data,
        error: value.get().error,
        isPending: value.get().isPending
      }) : options;
      $fetch(path, {
        ...opts,
        query: {
          ...opts?.query,
          ...queryParams?.query
        },
        async onSuccess(context) {
          if (requestId === latestRequestId) {
            const current = value.get();
            const stableData = current.data != null && context.data != null && isJsonEqual(current.data, context.data) ? current.data : context.data;
            value.set({
              data: stableData,
              error: null,
              isPending: false,
              isRefetching: false,
              refetch: value.value.refetch
            });
          }
          await opts?.onSuccess?.(context);
        },
        async onError(context) {
          const { request } = context;
          const retryAttempts = typeof request.retry === "number" ? request.retry : request.retry?.attempts;
          const retryAttempt = request.retryAttempt || 0;
          if (retryAttempts && retryAttempt < retryAttempts)
            return;
          if (requestId === latestRequestId) {
            const isUnauthorized = context.error.status === 401;
            value.set({
              error: context.error,
              data: isUnauthorized ? null : value.get().data,
              isPending: false,
              isRefetching: false,
              refetch: value.value.refetch
            });
          }
          await opts?.onError?.(context);
        },
        async onRequest(context) {
          if (requestId === latestRequestId) {
            const currentValue = value.get();
            value.set({
              isPending: currentValue.data === null,
              data: currentValue.data,
              error: null,
              isRefetching: true,
              refetch: value.value.refetch
            });
          }
          await opts?.onRequest?.(context);
        }
      }).catch((error) => {
        if (requestId !== latestRequestId)
          return;
        value.set({
          error,
          data: value.get().data,
          isPending: false,
          isRefetching: false,
          refetch: value.value.refetch
        });
      }).finally(() => {
        resolve(undefined);
      });
    });
  };
  initializedAtom = Array.isArray(initializedAtom) ? initializedAtom : [initializedAtom];
  let isMountFetchPending = false;
  let isMounted = false;
  let shouldRefetchAfterPending = false;
  const fetchOnMount = () => {
    if (isMountFetchPending) {
      shouldRefetchAfterPending = true;
      return;
    }
    isMountFetchPending = true;
    fn().finally(() => {
      isMountFetchPending = false;
      const shouldRefetch = shouldRefetchAfterPending && isMounted;
      shouldRefetchAfterPending = false;
      if (shouldRefetch)
        fetchOnMount();
    });
  };
  onMount(value, () => {
    if (isServer())
      return;
    isMounted = true;
    let isInitialized = false;
    let timeoutId;
    const cleanups = initializedAtom.map((initAtom) => initAtom.listen(() => {
      if (isInitialized)
        fn();
      else {
        isInitialized = true;
        clearTimeout(timeoutId);
        fetchOnMount();
      }
    }));
    timeoutId = setTimeout(() => {
      isInitialized = true;
      fetchOnMount();
    }, 0);
    return () => {
      isMounted = false;
      for (const cleanup of cleanups)
        cleanup();
      clearTimeout(timeoutId);
    };
  });
  return value;
};

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/session-refresh.mjs
var now2 = () => Math.floor(Date.now() / 1000);
var FOCUS_REFETCH_RATE_LIMIT_SECONDS = 5;
function createSessionRefreshManager(opts) {
  const { fetchSession, shouldPollSession = () => true, sessionSignal, options = {} } = opts;
  const refetchInterval = options.sessionOptions?.refetchInterval ?? 0;
  const refetchOnWindowFocus = options.sessionOptions?.refetchOnWindowFocus ?? true;
  const refetchWhenOffline = options.sessionOptions?.refetchWhenOffline ?? false;
  const state = {
    isInitialized: false,
    lastSessionRequest: 0
  };
  const shouldRefetch = () => {
    return refetchWhenOffline || getGlobalOnlineManager().isOnline;
  };
  const triggerRefetch = (event) => {
    if (!shouldRefetch())
      return;
    if (event?.event === "storage") {
      fetchSession();
      return;
    }
    if (event?.event === "poll") {
      state.lastSessionRequest = now2();
      fetchSession();
      return;
    }
    if (event?.event === "visibilitychange") {
      if (now2() - state.lastSessionRequest < FOCUS_REFETCH_RATE_LIMIT_SECONDS)
        return;
      state.lastSessionRequest = now2();
      fetchSession();
      return;
    }
    fetchSession();
  };
  const broadcastSessionUpdate = (trigger) => {
    getGlobalBroadcastChannel().post({
      event: "session",
      data: { trigger },
      clientId: Math.random().toString(36).substring(7)
    });
  };
  const setupPolling = () => {
    if (refetchInterval && refetchInterval > 0)
      state.pollInterval = setInterval(() => {
        if (shouldPollSession())
          triggerRefetch({ event: "poll" });
      }, refetchInterval * 1000);
  };
  const setupBroadcast = () => {
    state.unsubscribeBroadcast = getGlobalBroadcastChannel().subscribe(() => {
      triggerRefetch({ event: "storage" });
    });
  };
  const setupFocusRefetch = () => {
    if (!refetchOnWindowFocus)
      return;
    state.unsubscribeFocus = getGlobalFocusManager().subscribe(() => {
      triggerRefetch({ event: "visibilitychange" });
    });
  };
  const setupOnlineRefetch = () => {
    state.unsubscribeOnline = getGlobalOnlineManager().subscribe((online) => {
      if (online)
        triggerRefetch({ event: "visibilitychange" });
    });
  };
  const setupSignalSubscription = () => {
    state.unsubscribeSignal = sessionSignal.listen(() => {
      fetchSession();
    });
  };
  const init = () => {
    if (state.isInitialized)
      return;
    state.isInitialized = true;
    setupPolling();
    setupBroadcast();
    setupFocusRefetch();
    setupOnlineRefetch();
    setupSignalSubscription();
    state.cleanupBroadcastSetup = getGlobalBroadcastChannel().setup();
    state.cleanupFocusSetup = getGlobalFocusManager().setup();
    state.cleanupOnlineSetup = getGlobalOnlineManager().setup();
  };
  const cleanup = () => {
    if (!state.isInitialized)
      return;
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = undefined;
    }
    if (state.unsubscribeBroadcast) {
      state.unsubscribeBroadcast();
      state.unsubscribeBroadcast = undefined;
    }
    if (state.unsubscribeFocus) {
      state.unsubscribeFocus();
      state.unsubscribeFocus = undefined;
    }
    if (state.unsubscribeOnline) {
      state.unsubscribeOnline();
      state.unsubscribeOnline = undefined;
    }
    if (state.unsubscribeSignal) {
      state.unsubscribeSignal();
      state.unsubscribeSignal = undefined;
    }
    if (state.cleanupBroadcastSetup) {
      state.cleanupBroadcastSetup();
      state.cleanupBroadcastSetup = undefined;
    }
    if (state.cleanupFocusSetup) {
      state.cleanupFocusSetup();
      state.cleanupFocusSetup = undefined;
    }
    if (state.cleanupOnlineSetup) {
      state.cleanupOnlineSetup();
      state.cleanupOnlineSetup = undefined;
    }
    state.isInitialized = false;
    state.lastSessionRequest = 0;
  };
  return {
    init,
    cleanup,
    triggerRefetch,
    broadcastSessionUpdate
  };
}

// node_modules/.bun/@better-auth+core@1.7.13+3fbaf270a4e3f945/node_modules/@better-auth/core/dist/env/env-impl.mjs
var _envShim = Object.create(null);
var _getEnv = (useShim) => globalThis.process?.env || globalThis.Deno?.env.toObject() || globalThis.__env__ || (useShim ? _envShim : globalThis);
var env = new Proxy(_envShim, {
  get(_, prop) {
    return _getEnv()[prop] ?? _envShim[prop];
  },
  has(_, prop) {
    return prop in _getEnv() || prop in _envShim;
  },
  set(_, prop, value) {
    const env = _getEnv(true);
    env[prop] = value;
    return true;
  },
  deleteProperty(_, prop) {
    if (!prop)
      return false;
    const env = _getEnv(true);
    delete env[prop];
    return true;
  },
  ownKeys() {
    const env = _getEnv(true);
    return Object.keys(env);
  }
});
var nodeENV = env.NODE_ENV ?? "";
function getEnvVar(key, fallback) {
  if (typeof process !== "undefined" && process.env)
    return process.env[key] ?? fallback;
  if (typeof Deno !== "undefined")
    return Deno.env.get(key) ?? fallback;
  if (typeof Bun !== "undefined")
    return Bun.env[key] ?? fallback;
  return fallback;
}
var ENV = Object.freeze({
  get BETTER_AUTH_SECRET() {
    return getEnvVar("BETTER_AUTH_SECRET");
  },
  get AUTH_SECRET() {
    return getEnvVar("AUTH_SECRET");
  },
  get BETTER_AUTH_TELEMETRY() {
    return getEnvVar("BETTER_AUTH_TELEMETRY");
  },
  get BETTER_AUTH_TELEMETRY_ID() {
    return getEnvVar("BETTER_AUTH_TELEMETRY_ID");
  },
  get NODE_ENV() {
    return getEnvVar("NODE_ENV", "development");
  },
  get PACKAGE_VERSION() {
    return getEnvVar("PACKAGE_VERSION", "0.0.0");
  },
  get BETTER_AUTH_TELEMETRY_ENDPOINT() {
    return getEnvVar("BETTER_AUTH_TELEMETRY_ENDPOINT", "");
  }
});
// node_modules/.bun/@better-auth+core@1.7.13+3fbaf270a4e3f945/node_modules/@better-auth/core/dist/utils/error-codes.mjs
function defineErrorCodes(codes) {
  return Object.fromEntries(Object.entries(codes).map(([key, value]) => [key, {
    code: key,
    message: value,
    toString: () => key
  }]));
}

// node_modules/.bun/better-call@1.4.4+969a6d035afea0f4/node_modules/better-call/dist/error.mjs
function isErrorStackTraceLimitWritable() {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined)
    return Object.isExtensible(Error);
  return Object.prototype.hasOwnProperty.call(desc, "writable") ? desc.writable : desc.set !== undefined;
}
function hideInternalStackFrames(stack) {
  const lines = stack.split(`
    at `);
  if (lines.length <= 1)
    return stack;
  lines.splice(1, 1);
  return lines.join(`
    at `);
}
function makeErrorForHideStackFrame(Base, clazz) {

  class HideStackFramesError extends Base {
    #hiddenStack;
    constructor(...args) {
      if (isErrorStackTraceLimitWritable()) {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
        super(...args);
        Error.stackTraceLimit = limit;
      } else
        super(...args);
      const stack = (/* @__PURE__ */ new Error()).stack;
      if (stack)
        this.#hiddenStack = hideInternalStackFrames(stack.replace(/^Error/, this.name));
    }
    get errorStack() {
      return this.#hiddenStack;
    }
  }
  Object.defineProperty(HideStackFramesError.prototype, "constructor", {
    get() {
      return clazz;
    },
    enumerable: false,
    configurable: true
  });
  return HideStackFramesError;
}
var statusCodes = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  "I'M_A_TEAPOT": 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511
};
var InternalAPIError = class extends Error {
  status;
  body;
  headers;
  statusCode;
  constructor(status = "INTERNAL_SERVER_ERROR", body = undefined, headers = {}, statusCode = typeof status === "number" ? status : statusCodes[status]) {
    super(body?.message, body && "cause" in body ? { cause: body.cause } : undefined);
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.statusCode = statusCode;
    this.name = "APIError";
    this.status = status;
    this.headers = headers;
    this.statusCode = statusCode;
    if (body && "cause" in body) {
      const { cause, ...publicBody } = body;
      this.body = Object.defineProperty(publicBody, "cause", {
        value: cause,
        writable: true,
        configurable: true
      });
      return;
    }
    this.body = body;
  }
};
var kAPIErrorHeaderSymbol = Symbol.for("better-call:api-error-headers");
var APIError = makeErrorForHideStackFrame(InternalAPIError, Error);

// node_modules/.bun/@better-auth+core@1.7.13+3fbaf270a4e3f945/node_modules/@better-auth/core/dist/error/index.mjs
var BetterAuthError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BetterAuthError";
    this.message = message;
    this.stack = "";
  }
};

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/utils/url.mjs
var SLASH_CHAR_CODE = 47;
function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH_CHAR_CODE)
    end--;
  return end === value.length ? value : value.slice(0, end);
}
function checkHasPath(url) {
  try {
    return (trimTrailingSlashes(new URL(url).pathname) || "/") !== "/";
  } catch {
    throw new BetterAuthError(`Invalid base URL: ${url}. Please provide a valid base URL.`);
  }
}
function assertHasProtocol(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
      throw new BetterAuthError(`Invalid base URL: ${url}. URL must include 'http://' or 'https://'`);
  } catch (error) {
    if (error instanceof BetterAuthError)
      throw error;
    throw new BetterAuthError(`Invalid base URL: ${url}. Please provide a valid base URL.`, { cause: error });
  }
}
function withPath(url, path = "/api/auth") {
  assertHasProtocol(url);
  if (checkHasPath(url))
    return url;
  const trimmedUrl = trimTrailingSlashes(url);
  if (!path || path === "/")
    return trimmedUrl;
  path = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedUrl}${path}`;
}
function validateProxyHeader(header, type) {
  if (!header || header.trim() === "")
    return false;
  if (type === "proto")
    return header === "http" || header === "https";
  if (type === "host") {
    if ([
      /\.\./,
      /\0/,
      /[\s]/,
      /^[.]/,
      /[<>'"]/,
      /javascript:/i,
      /file:/i,
      /data:/i
    ].some((pattern) => pattern.test(header)))
      return false;
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(:[0-9]{1,5})?$/.test(header) || /^(\d{1,3}\.){3}\d{1,3}(:[0-9]{1,5})?$/.test(header) || /^\[[0-9a-fA-F:]+\](:[0-9]{1,5})?$/.test(header) || /^localhost(:[0-9]{1,5})?$/i.test(header);
  }
  return false;
}
function getBaseURL(url, path, request, loadEnv, trustedProxyHeaders) {
  if (url)
    return withPath(url, path);
  if (loadEnv !== false) {
    const fromEnv = env.BETTER_AUTH_URL || env.NEXT_PUBLIC_BETTER_AUTH_URL || env.PUBLIC_BETTER_AUTH_URL || env.NUXT_PUBLIC_BETTER_AUTH_URL || env.NUXT_PUBLIC_AUTH_URL || (env.BASE_URL !== "/" ? env.BASE_URL : undefined);
    if (fromEnv)
      return withPath(fromEnv, path);
  }
  const fromRequest = request?.headers.get("x-forwarded-host");
  const fromRequestProto = request?.headers.get("x-forwarded-proto");
  if (fromRequest && fromRequestProto && trustedProxyHeaders) {
    if (validateProxyHeader(fromRequestProto, "proto") && validateProxyHeader(fromRequest, "host"))
      try {
        return withPath(`${fromRequestProto}://${fromRequest}`, path);
      } catch (_error) {}
  }
  if (request) {
    const url = getOrigin(request.url);
    if (!url)
      throw new BetterAuthError("Could not get origin from request. Please provide a valid base URL.");
    return withPath(url, path);
  }
  if (typeof window !== "undefined" && window.location)
    return withPath(window.location.origin, path);
}
function getOrigin(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.origin === "null" ? null : parsedUrl.origin;
  } catch {
    return null;
  }
}

// node_modules/.bun/@better-auth+core@1.7.13+3fbaf270a4e3f945/node_modules/@better-auth/core/dist/utils/url.mjs
var DANGEROUS_URL_SCHEMES = [
  "javascript:",
  "data:",
  "vbscript:"
];
function isSafeUrlScheme(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return true;
  }
  return !DANGEROUS_URL_SCHEMES.includes(parsed.protocol);
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/fetch-plugins.mjs
var redirectPlugin = {
  id: "redirect",
  name: "Redirect",
  hooks: { onSuccess(context) {
    if (context.data?.url && context.data?.redirect && isSafeUrlScheme(context.data.url)) {
      if (typeof window !== "undefined" && window.location) {
        if (window.location)
          try {
            window.location.href = context.data.url;
          } catch {}
      }
    }
  } }
};

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/session-atom.mjs
var isServer2 = () => typeof window === "undefined";
var SESSION_MOUNT_DEDUPE_INTERVAL = STORE_UNMOUNT_DELAY;
function hydrateSessionAtom(sessionAtom, session) {
  if (typeof window === "undefined")
    return;
  const currentSession = sessionAtom.get();
  if (currentSession.data !== null || session === null)
    return;
  sessionAtom.set({
    ...currentSession,
    data: session,
    error: null,
    isPending: false
  });
}
function normalizeSessionResponse(res) {
  if (typeof res === "object" && res !== null && "data" in res && "error" in res)
    return res;
  return {
    data: res,
    error: null
  };
}
function normalizeSessionData(data) {
  if (!data)
    return null;
  if (data.session === null && data.user === null)
    return null;
  return data;
}
function isSessionAtomEqual(a, b) {
  return isJsonEqual(a.data, b.data) && a.error === b.error && a.isPending === b.isPending && a.isRefetching === b.isRefetching && a.refetch === b.refetch;
}
function getSessionAtom($fetch, options) {
  const $signal = atom(false);
  let flight;
  let freshUntil = 0;
  let sessionRevision = 0;
  $signal.listen(() => {
    sessionRevision++;
    freshUntil = 0;
  });
  const refetch = (queryParams) => fetchSession(queryParams);
  const session = createAuthQueryAtom({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch
  });
  withEquality(session, isSessionAtomEqual);
  const executeSessionFetch = async (signal, queryParams) => {
    const current = session.value;
    session.set({
      ...current,
      isPending: current.data === null,
      isRefetching: true,
      error: null,
      refetch
    });
    if (signal.aborted)
      return "aborted";
    try {
      const res = await $fetch("/get-session", {
        method: "GET",
        query: queryParams?.query,
        signal
      });
      if (signal.aborted)
        return "aborted";
      let { data, error } = normalizeSessionResponse(res);
      let outcome = "fresh";
      if (data?.needsRefresh)
        try {
          const refreshRes = await $fetch("/get-session", {
            method: "POST",
            signal
          });
          if (signal.aborted)
            return "aborted";
          ({ data, error } = normalizeSessionResponse(refreshRes));
        } catch {
          if (signal.aborted)
            return "aborted";
          outcome = "stale";
        }
      if (error) {
        const latest = session.value;
        const isUnauthorized = error?.status === 401;
        session.set({
          data: isUnauthorized ? null : latest.data,
          error,
          isPending: false,
          isRefetching: false,
          refetch
        });
        return "failed";
      }
      const sessionData = normalizeSessionData(data);
      const current = session.value;
      const stableData = current.data != null && sessionData != null && isJsonEqual(current.data, sessionData) ? current.data : sessionData;
      session.set({
        data: stableData,
        error: null,
        isPending: false,
        isRefetching: false,
        refetch
      });
      return outcome;
    } catch (fetchError) {
      if (signal.aborted)
        return "aborted";
      const latest = session.value;
      session.set({
        data: latest.data,
        error: fetchError,
        isPending: false,
        isRefetching: false,
        refetch
      });
      return "failed";
    }
  };
  const getFreshUntil = () => {
    const expiresAt = session.value.data?.session?.expiresAt;
    const sessionExpiresAt = expiresAt instanceof Date ? expiresAt.getTime() : Number.POSITIVE_INFINITY;
    return Math.min(Date.now() + SESSION_MOUNT_DEDUPE_INTERVAL, sessionExpiresAt);
  };
  const fetchSession = (queryParams) => {
    freshUntil = 0;
    flight?.cancel();
    const controller = new AbortController;
    const request = {
      cancel: () => controller.abort(),
      promise: Promise.resolve().then(() => {
        if (controller.signal.aborted)
          return "aborted";
        return executeSessionFetch(controller.signal, queryParams);
      }),
      revision: sessionRevision
    };
    flight = request;
    const settleFlight = (outcome) => {
      if (flight !== request)
        return;
      flight = undefined;
      if (outcome === "fresh" && request.revision === sessionRevision)
        freshUntil = getFreshUntil();
    };
    request.promise.then(settleFlight, () => settleFlight("failed"));
    return request.promise.then(() => {
      return;
    });
  };
  const fetchSessionOnMount = () => {
    if (flight?.revision === sessionRevision)
      return flight.promise.then(() => {
        return;
      });
    if (Date.now() < freshUntil)
      return Promise.resolve();
    return fetchSession();
  };
  let broadcastSessionUpdate = () => {};
  onMount(session, () => {
    let timeoutId;
    if (!isServer2())
      timeoutId = setTimeout(() => {
        fetchSessionOnMount();
      }, 0);
    const refreshManager = createSessionRefreshManager({
      fetchSession,
      shouldPollSession: () => session.value.data != null,
      sessionSignal: $signal,
      options
    });
    refreshManager.init();
    broadcastSessionUpdate = refreshManager.broadcastSessionUpdate;
    return () => {
      if (timeoutId)
        clearTimeout(timeoutId);
      refreshManager.cleanup();
    };
  });
  return {
    session,
    $sessionSignal: $signal,
    broadcastSessionUpdate: (trigger) => broadcastSessionUpdate(trigger)
  };
}

// node_modules/.bun/defu@6.1.7/node_modules/defu/dist/defu.mjs
function isPlainObject2(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
    return false;
  }
  if (Symbol.iterator in value) {
    return false;
  }
  if (Symbol.toStringTag in value) {
    return Object.prototype.toString.call(value) === "[object Module]";
  }
  return true;
}
function _defu(baseObject, defaults, namespace = ".", merger) {
  if (!isPlainObject2(defaults)) {
    return _defu(baseObject, {}, namespace, merger);
  }
  const object = { ...defaults };
  for (const key of Object.keys(baseObject)) {
    if (key === "__proto__" || key === "constructor") {
      continue;
    }
    const value = baseObject[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (merger && merger(object, key, value, namespace)) {
      continue;
    }
    if (Array.isArray(value) && Array.isArray(object[key])) {
      object[key] = [...value, ...object[key]];
    } else if (isPlainObject2(value) && isPlainObject2(object[key])) {
      object[key] = _defu(value, object[key], (namespace ? `${namespace}.` : "") + key.toString(), merger);
    } else {
      object[key] = value;
    }
  }
  return object;
}
function createDefu(merger) {
  return (...arguments_) => arguments_.reduce((p, c) => _defu(p, c, "", merger), {});
}
var defu = createDefu();
var defuFn = createDefu((object, key, currentValue) => {
  if (object[key] !== undefined && typeof currentValue === "function") {
    object[key] = currentValue(object[key]);
    return true;
  }
});
var defuArrayFn = createDefu((object, key, currentValue) => {
  if (Array.isArray(object[key]) && typeof currentValue === "function") {
    object[key] = currentValue(object[key]);
    return true;
  }
});

// node_modules/.bun/@better-fetch+fetch@1.3.3/node_modules/@better-fetch/fetch/dist/index.js
var BetterFetchError = class extends Error {
  constructor(status, statusText, error) {
    super(statusText || status.toString(), { cause: error });
    this.status = status;
    this.statusText = statusText;
    this.error = error;
    Error.captureStackTrace(this, this.constructor);
  }
};
var initializePlugins = async (url, options) => {
  let opts = options || {};
  const hooks = {
    onRequest: [options === null || options === undefined ? undefined : options.onRequest],
    onResponse: [options === null || options === undefined ? undefined : options.onResponse],
    onSuccess: [options === null || options === undefined ? undefined : options.onSuccess],
    onError: [options === null || options === undefined ? undefined : options.onError],
    onRetry: [options === null || options === undefined ? undefined : options.onRetry]
  };
  if (!options || !(options === null || options === undefined ? undefined : options.plugins))
    return {
      url,
      options: opts,
      hooks
    };
  for (const plugin of (options === null || options === undefined ? undefined : options.plugins) || []) {
    var _plugin$hooks, _plugin$hooks2, _plugin$hooks3, _plugin$hooks4, _plugin$hooks5;
    if (plugin.init) {
      var _plugin$init;
      const pluginRes = await ((_plugin$init = plugin.init) === null || _plugin$init === undefined ? undefined : _plugin$init.call(plugin, url.toString(), opts));
      opts = pluginRes.options || opts;
      url = pluginRes.url;
    }
    hooks.onRequest.push((_plugin$hooks = plugin.hooks) === null || _plugin$hooks === undefined ? undefined : _plugin$hooks.onRequest);
    hooks.onResponse.push((_plugin$hooks2 = plugin.hooks) === null || _plugin$hooks2 === undefined ? undefined : _plugin$hooks2.onResponse);
    hooks.onSuccess.push((_plugin$hooks3 = plugin.hooks) === null || _plugin$hooks3 === undefined ? undefined : _plugin$hooks3.onSuccess);
    hooks.onError.push((_plugin$hooks4 = plugin.hooks) === null || _plugin$hooks4 === undefined ? undefined : _plugin$hooks4.onError);
    hooks.onRetry.push((_plugin$hooks5 = plugin.hooks) === null || _plugin$hooks5 === undefined ? undefined : _plugin$hooks5.onRetry);
  }
  return {
    url,
    options: opts,
    hooks
  };
};
var LinearRetryStrategy = class {
  constructor(options) {
    this.options = options;
  }
  shouldAttemptRetry(attempt, response) {
    if (this.options.shouldRetry)
      return Promise.resolve(attempt < this.options.attempts && this.options.shouldRetry(response));
    return Promise.resolve(attempt < this.options.attempts);
  }
  getDelay() {
    return this.options.delay;
  }
};
var ExponentialRetryStrategy = class {
  constructor(options) {
    this.options = options;
  }
  shouldAttemptRetry(attempt, response) {
    if (this.options.shouldRetry)
      return Promise.resolve(attempt < this.options.attempts && this.options.shouldRetry(response));
    return Promise.resolve(attempt < this.options.attempts);
  }
  getDelay(attempt) {
    return Math.min(this.options.maxDelay, this.options.baseDelay * 2 ** attempt);
  }
};
function createRetryStrategy(options) {
  if (typeof options === "number")
    return new LinearRetryStrategy({
      type: "linear",
      attempts: options,
      delay: 1000
    });
  switch (options.type) {
    case "linear":
      return new LinearRetryStrategy(options);
    case "exponential":
      return new ExponentialRetryStrategy(options);
    default:
      throw new Error("Invalid retry strategy");
  }
}
var methods = [
  "get",
  "post",
  "put",
  "patch",
  "delete"
];
function parseMethodModifier(path) {
  if (!path.startsWith("@"))
    return {
      method: undefined,
      path
    };
  const separator = path.indexOf("/");
  const method = path.slice(1, separator === -1 ? undefined : separator);
  if (!methods.includes(method))
    return {
      method: undefined,
      path
    };
  return {
    method,
    path: separator === -1 ? path : path.slice(separator + 1)
  };
}
var ORIGIN_RE = /^[a-z][a-z\d+.-]*:\/\/[^/?#]+/i;
var LEADING_SLASHES_RE = /^\/+/;
function withoutTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/")
    end--;
  return value.slice(0, end);
}
function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  if (index === -1)
    return [value, undefined];
  return [value.slice(0, index), value.slice(index + 1)];
}
var isReservedPathSegment = (value) => value === "." || value === "..";
var encodeLiteralPathSegment = (segment) => segment.split(":").map((part) => encodeURIComponent(part)).join(":");
function resolvePathSegment(segment, pathParams) {
  const pathParam = pathParams.get(segment);
  if (pathParam === undefined)
    return encodeLiteralPathSegment(segment);
  if (isReservedPathSegment(pathParam))
    throw new TypeError("Path parameters cannot be reserved path segments");
  return encodeURIComponent(pathParam);
}
function getPathParams(path, params) {
  const pathParams = /* @__PURE__ */ new Map;
  if (params)
    if (Array.isArray(params)) {
      const paramPaths = path.split("/").filter((p) => p.startsWith(":"));
      for (const [index, key] of paramPaths.entries()) {
        const value = params[index];
        pathParams.set(key, String(value));
      }
    } else
      for (const [key, value] of Object.entries(params))
        pathParams.set(`:${key}`, String(value));
  return pathParams;
}
function fillPath(path, params) {
  const pathParams = getPathParams(path, params);
  return path.split("/").map((segment) => resolvePathSegment(segment, pathParams)).join("/");
}
function serializeQuery(urlQuery, query) {
  const queryParams = new URLSearchParams(urlQuery);
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null)
      continue;
    let serializedValue;
    if (typeof value === "string")
      serializedValue = value;
    else if (Array.isArray(value)) {
      for (const val of value)
        queryParams.append(key, val);
      continue;
    } else
      serializedValue = JSON.stringify(value);
    queryParams.set(key, serializedValue);
  }
  const queryParamString = queryParams.toString();
  return queryParamString.length > 0 ? `?${queryParamString}`.replace(/\+/g, "%20") : "";
}
function withoutBase(input, baseURL) {
  if (!baseURL)
    return input;
  const basePath = `${withoutTrailingSlashes(baseURL)}/`;
  return input.startsWith(basePath) ? input.slice(basePath.length) : input;
}
function joinURL(base, path, urlQuery, query) {
  const [baseWithoutHash] = splitOnce(base, "#");
  const [basePath, baseQuery = ""] = splitOnce(baseWithoutHash, "?");
  const relativePath = path.replace(LEADING_SLASHES_RE, "");
  const search = serializeQuery(`${baseQuery}&${urlQuery !== null && urlQuery !== undefined ? urlQuery : ""}`, query);
  const href = `${withoutTrailingSlashes(basePath)}/${relativePath}${search}`;
  return ORIGIN_RE.test(href) ? new URL(href) : href;
}
function getURL$1(url, option) {
  var _input$match, _ref;
  const { baseURL, params, query } = option || {
    query: {},
    params: {},
    baseURL: ""
  };
  const { path: requestPath } = parseMethodModifier(url);
  const input = requestPath === url ? url : `/${requestPath}`;
  const origin = (_input$match = input.match(ORIGIN_RE)) === null || _input$match === undefined ? undefined : _input$match[0];
  const [path, urlQuery] = splitOnce(origin ? input.slice(origin.length) : withoutBase(input, baseURL), "?");
  const filledPath = fillPath(path, params);
  return joinURL((_ref = origin !== null && origin !== undefined ? origin : baseURL) !== null && _ref !== undefined ? _ref : "", filledPath, urlQuery, query);
}
var getAuthHeader = async (options) => {
  const headers = {};
  const getValue = async (value) => typeof value === "function" ? await value() : value;
  if (options === null || options === undefined ? undefined : options.auth) {
    if (options.auth.type === "Bearer") {
      const token = await getValue(options.auth.token);
      if (!token)
        return headers;
      headers["authorization"] = `Bearer ${token}`;
    } else if (options.auth.type === "Basic") {
      const [username, password] = await Promise.all([getValue(options.auth.username), getValue(options.auth.password)]);
      if (!username || !password)
        return headers;
      headers["authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
    } else if (options.auth.type === "Custom") {
      const [prefix, value] = await Promise.all([getValue(options.auth.prefix), getValue(options.auth.value)]);
      if (!value)
        return headers;
      headers["authorization"] = `${prefix !== null && prefix !== undefined ? prefix : ""} ${value}`;
    }
  }
  return headers;
};
var JSON_RE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json(;.+)?$/i;
function detectResponseType(request) {
  const _contentType = request.headers.get("content-type");
  const textTypes = /* @__PURE__ */ new Set([
    "image/svg",
    "application/xml",
    "application/xhtml",
    "application/html"
  ]);
  if (!_contentType)
    return "json";
  const contentType = _contentType.split(";").shift() || "";
  if (JSON_RE.test(contentType))
    return "json";
  if (textTypes.has(contentType) || contentType.startsWith("text/"))
    return "text";
  return "blob";
}
function isJSONParsable(value) {
  try {
    JSON.parse(value);
    return true;
  } catch (error) {
    return false;
  }
}
function isJSONSerializable(value) {
  if (value === undefined)
    return false;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === null)
    return true;
  if (t !== "object")
    return false;
  if (Array.isArray(value))
    return true;
  if (value.buffer)
    return false;
  return value.constructor && value.constructor.name === "Object" || typeof value.toJSON === "function";
}
function jsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}
function isFunction(value) {
  return typeof value === "function";
}
function getFetch(options) {
  if (options === null || options === undefined ? undefined : options.customFetchImpl)
    return options.customFetchImpl;
  if (typeof globalThis !== "undefined" && isFunction(globalThis.fetch))
    return globalThis.fetch;
  if (typeof window !== "undefined" && isFunction(window.fetch))
    return window.fetch;
  throw new Error("No fetch implementation found");
}
function mergeHeaders(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source)
      continue;
    if (source instanceof Headers)
      source.forEach((value, key) => {
        merged[key] = value;
      });
    else {
      const entries = Array.isArray(source) ? source : Object.entries(source);
      for (const [key, value] of entries)
        if (value !== null && value !== undefined)
          merged[key] = value;
    }
  }
  return merged;
}
async function getHeaders(opts) {
  const headers = new Headers(mergeHeaders(opts === null || opts === undefined ? undefined : opts.headers, await getAuthHeader(opts)));
  if (!headers.has("content-type")) {
    const contentType = detectContentType(opts === null || opts === undefined ? undefined : opts.body);
    if (contentType)
      headers.set("content-type", contentType);
  }
  return headers;
}
function detectContentType(body) {
  if (isJSONSerializable(body))
    return "application/json";
  return null;
}
function getMediaType(headers) {
  const contentType = headers.get("content-type");
  return contentType ? contentType.split(";")[0].trim().toLowerCase() : null;
}
function getBody(options, headers) {
  const { body } = options;
  if (!body)
    return null;
  if (!isJSONSerializable(body))
    return body;
  if (typeof body === "string")
    return body;
  if (getMediaType(headers) === "application/x-www-form-urlencoded")
    return new URLSearchParams(body).toString();
  return JSON.stringify(body);
}
function getMethod(url, options) {
  if (options === null || options === undefined ? undefined : options.method)
    return options.method.toUpperCase();
  const { method } = parseMethodModifier(url);
  if (method)
    return method.toUpperCase();
  return (options === null || options === undefined ? undefined : options.body) ? "POST" : "GET";
}
function getTimeout(options, controller) {
  let abortTimeout;
  if (!(options === null || options === undefined ? undefined : options.signal) && (options === null || options === undefined ? undefined : options.timeout))
    abortTimeout = setTimeout(() => controller === null || controller === undefined ? undefined : controller.abort(), options === null || options === undefined ? undefined : options.timeout);
  return {
    abortTimeout,
    clearTimeout: () => {
      if (abortTimeout)
        clearTimeout(abortTimeout);
    }
  };
}
var ValidationError = class ValidationError extends Error {
  constructor(issues, message) {
    super(message || JSON.stringify(issues, null, 2));
    this.issues = issues;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
};
async function parseStandardSchema(schema, input) {
  const result = await schema["~standard"].validate(input);
  if (result.issues)
    throw new ValidationError(result.issues);
  return result.value;
}
function _typeof(o) {
  "@babel/helpers - typeof";
  return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o) {
    return typeof o;
  } : function(o) {
    return o && typeof Symbol == "function" && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}
function toPrimitive(t, r) {
  if (_typeof(t) != "object" || !t)
    return t;
  var e = t[Symbol.toPrimitive];
  if (e !== undefined) {
    var i = e.call(t, r || "default");
    if (_typeof(i) != "object")
      return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (r === "string" ? String : Number)(t);
}
function toPropertyKey(t) {
  var i = toPrimitive(t, "string");
  return _typeof(i) == "symbol" ? i : i + "";
}
function _defineProperty(e, r, t) {
  return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r] = t, e;
}
function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r && (o = o.filter(function(r) {
      return Object.getOwnPropertyDescriptor(e, r).enumerable;
    })), t.push.apply(t, o);
  }
  return t;
}
function _objectSpread2(e) {
  for (var r = 1;r < arguments.length; r++) {
    var t = arguments[r] != null ? arguments[r] : {};
    r % 2 ? ownKeys(Object(t), true).forEach(function(r) {
      _defineProperty(e, r, t[r]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
      Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
    });
  }
  return e;
}
var betterFetch = async (url, options) => {
  var _opts$signal, _options$body, _options$jsonParser;
  const { hooks, url: __url, options: opts } = await initializePlugins(url, options);
  const fetch2 = getFetch(opts);
  const controller = new AbortController;
  const signal = (_opts$signal = opts.signal) !== null && _opts$signal !== undefined ? _opts$signal : controller.signal;
  const _url = getURL$1(__url, opts);
  const headers = await getHeaders(opts);
  const body = getBody(opts, headers);
  const method = getMethod(__url, opts);
  const context = _objectSpread2(_objectSpread2({}, opts), {}, {
    url: _url,
    headers,
    body,
    method,
    signal
  });
  for (const onRequest of hooks.onRequest)
    if (onRequest) {
      const res = await onRequest(context);
      if (typeof res === "object" && res !== null)
        Object.assign(context, res);
    }
  if ("pipeTo" in context && typeof context.pipeTo === "function" || typeof (options === null || options === undefined || (_options$body = options.body) === null || _options$body === undefined ? undefined : _options$body.pipe) === "function") {
    if (!("duplex" in context))
      context.duplex = "half";
  }
  const { clearTimeout: clearTimeout2 } = getTimeout(opts, controller);
  let response = await fetch2(context.url, context);
  clearTimeout2();
  const responseContext = {
    response,
    request: context
  };
  for (const onResponse of hooks.onResponse)
    if (onResponse) {
      var _options$hookOptions;
      const r = await onResponse(_objectSpread2(_objectSpread2({}, responseContext), {}, { response: (options === null || options === undefined || (_options$hookOptions = options.hookOptions) === null || _options$hookOptions === undefined ? undefined : _options$hookOptions.cloneResponse) ? response.clone() : response }));
      if (r instanceof Response)
        response = r;
      else if (typeof r === "object" && r !== null)
        response = r.response;
    }
  if (response.ok) {
    if (!(context.method !== "HEAD"))
      return {
        data: "",
        error: null
      };
    const responseType = detectResponseType(response);
    const successContext = {
      data: null,
      response,
      request: context
    };
    if (responseType === "json" || responseType === "text") {
      var _context$jsonParser;
      const text = await response.text();
      successContext.data = await ((_context$jsonParser = context.jsonParser) !== null && _context$jsonParser !== undefined ? _context$jsonParser : jsonParse)(text);
    } else
      successContext.data = await response[responseType]();
    if (context === null || context === undefined ? undefined : context.output) {
      if (context.output && !context.disableValidation)
        successContext.data = await parseStandardSchema(context.output, successContext.data);
    }
    for (const onSuccess of hooks.onSuccess)
      if (onSuccess) {
        var _options$hookOptions2;
        await onSuccess(_objectSpread2(_objectSpread2({}, successContext), {}, { response: (options === null || options === undefined || (_options$hookOptions2 = options.hookOptions) === null || _options$hookOptions2 === undefined ? undefined : _options$hookOptions2.cloneResponse) ? response.clone() : response }));
      }
    if (options === null || options === undefined ? undefined : options.throw)
      return successContext.data;
    return {
      data: successContext.data,
      error: null
    };
  }
  const parser = (_options$jsonParser = options === null || options === undefined ? undefined : options.jsonParser) !== null && _options$jsonParser !== undefined ? _options$jsonParser : jsonParse;
  const responseText = await response.text();
  const isJSONResponse = isJSONParsable(responseText);
  const errorObject = isJSONResponse ? await parser(responseText) : null;
  const errorContext = {
    response,
    responseText,
    request: context,
    error: _objectSpread2(_objectSpread2({}, errorObject), {}, {
      status: response.status,
      statusText: response.statusText
    })
  };
  for (const onError of hooks.onError)
    if (onError) {
      var _options$hookOptions3;
      await onError(_objectSpread2(_objectSpread2({}, errorContext), {}, { response: (options === null || options === undefined || (_options$hookOptions3 = options.hookOptions) === null || _options$hookOptions3 === undefined ? undefined : _options$hookOptions3.cloneResponse) ? response.clone() : response }));
    }
  if (options === null || options === undefined ? undefined : options.retry) {
    var _options$retryAttempt;
    const retryStrategy = createRetryStrategy(options.retry);
    const _retryAttempt = (_options$retryAttempt = options.retryAttempt) !== null && _options$retryAttempt !== undefined ? _options$retryAttempt : 0;
    if (await retryStrategy.shouldAttemptRetry(_retryAttempt, response)) {
      for (const onRetry of hooks.onRetry)
        if (onRetry)
          await onRetry(responseContext);
      const delay = retryStrategy.getDelay(_retryAttempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await betterFetch(url, _objectSpread2(_objectSpread2({}, options), {}, { retryAttempt: _retryAttempt + 1 }));
    }
  }
  if (options === null || options === undefined ? undefined : options.throw)
    throw new BetterFetchError(response.status, response.statusText, isJSONResponse ? errorObject : responseText);
  return {
    data: null,
    error: _objectSpread2(_objectSpread2({}, errorObject), {}, {
      status: response.status,
      statusText: response.statusText
    })
  };
};
var applySchemaPlugin = (config) => ({
  id: "apply-schema",
  name: "Apply Schema",
  version: "1.0.0",
  async init(url, options) {
    var _config$plugins;
    let opts = _objectSpread2(_objectSpread2({}, options), config.query !== undefined && { query: _objectSpread2(_objectSpread2({}, config.query), options === null || options === undefined ? undefined : options.query) });
    const schema = ((_config$plugins = config.plugins) === null || _config$plugins === undefined || (_config$plugins = _config$plugins.find((plugin) => {
      var _plugin$schema;
      return ((_plugin$schema = plugin.schema) === null || _plugin$schema === undefined ? undefined : _plugin$schema.config) ? url.startsWith(plugin.schema.config.baseURL || "") || url.startsWith(plugin.schema.config.prefix || "") : false;
    })) === null || _config$plugins === undefined ? undefined : _config$plugins.schema) || config.schema;
    if (schema) {
      var _schema$config, _schema$config2;
      let urlKey = url;
      if ((_schema$config = schema.config) === null || _schema$config === undefined ? undefined : _schema$config.prefix) {
        if (urlKey.startsWith(schema.config.prefix)) {
          urlKey = urlKey.replace(schema.config.prefix, "");
          if (schema.config.baseURL)
            url = url.replace(schema.config.prefix, schema.config.baseURL);
        }
      }
      if ((_schema$config2 = schema.config) === null || _schema$config2 === undefined ? undefined : _schema$config2.baseURL) {
        if (urlKey.startsWith(schema.config.baseURL))
          urlKey = urlKey.replace(schema.config.baseURL, "");
      }
      if (urlKey.startsWith("/") && urlKey.charAt(1) === "@")
        urlKey = urlKey.substring(1);
      const keySchema = schema.schema[urlKey];
      if (keySchema) {
        var _keySchema$method;
        const { method: schemaMethod, path } = parseMethodModifier(urlKey);
        if (schemaMethod)
          url = url.slice(0, url.length - urlKey.length) + path;
        let validatedHeaders = options === null || options === undefined ? undefined : options.headers;
        if (keySchema.headers && !(options === null || options === undefined ? undefined : options.disableValidation)) {
          const normalizedHeaders = {};
          if (options === null || options === undefined ? undefined : options.headers) {
            if (options.headers instanceof Headers)
              options.headers.forEach((value, key) => {
                normalizedHeaders[key.toLowerCase()] = value;
              });
            else if (typeof options.headers === "object") {
              for (const [key, value] of Object.entries(options.headers))
                if (value !== null && value !== undefined)
                  normalizedHeaders[key.toLowerCase()] = value;
            }
          }
          const validated = await parseStandardSchema(keySchema.headers, normalizedHeaders);
          const finalHeaders = {};
          for (const [key, value] of Object.entries(validated))
            finalHeaders[key.toLowerCase()] = value;
          validatedHeaders = finalHeaders;
        }
        const method = (_keySchema$method = keySchema.method) !== null && _keySchema$method !== undefined ? _keySchema$method : schemaMethod;
        opts = _objectSpread2(_objectSpread2(_objectSpread2(_objectSpread2({}, opts), method !== undefined && { method }), keySchema.output !== undefined && { output: keySchema.output }), validatedHeaders !== undefined && { headers: validatedHeaders });
        if (!(options === null || options === undefined ? undefined : options.disableValidation)) {
          if (keySchema.query) {
            opts.query = await parseStandardSchema(keySchema.query, options === null || options === undefined ? undefined : options.query);
            if (opts.query !== null && typeof opts.query === "object") {
              const defaults = _objectSpread2({}, config.query);
              for (const key of Object.keys(defaults))
                if ((options === null || options === undefined ? undefined : options.query) && Object.prototype.hasOwnProperty.call(options.query, key))
                  defaults[key] = options.query[key];
              opts.query = _objectSpread2(_objectSpread2({}, defaults), opts.query);
            }
          }
          opts = _objectSpread2(_objectSpread2({}, opts), {}, {
            body: keySchema.input ? await parseStandardSchema(keySchema.input, options === null || options === undefined ? undefined : options.body) : options === null || options === undefined ? undefined : options.body,
            params: keySchema.params ? await parseStandardSchema(keySchema.params, options === null || options === undefined ? undefined : options.params) : options === null || options === undefined ? undefined : options.params
          });
        }
        return {
          url,
          options: opts
        };
      }
    }
    return _objectSpread2({ url }, (options !== undefined || config.query !== undefined) && { options: opts });
  }
});
var createFetch = (config) => {
  async function $fetch(url, options) {
    const opts = _objectSpread2(_objectSpread2(_objectSpread2({}, config), options), {}, {
      headers: mergeHeaders(config === null || config === undefined ? undefined : config.headers, options === null || options === undefined ? undefined : options.headers),
      plugins: [
        ...(config === null || config === undefined ? undefined : config.plugins) || [],
        applySchemaPlugin(config || {}),
        ...(options === null || options === undefined ? undefined : options.plugins) || []
      ]
    });
    if (config === null || config === undefined ? undefined : config.catchAllError)
      try {
        return await betterFetch(url, opts);
      } catch (error) {
        return {
          data: null,
          error: {
            status: 500,
            statusText: "Fetch Error",
            message: "Fetch related error. Captured by catchAllError option. See error property for more details.",
            error
          }
        };
      }
    return await betterFetch(url, opts);
  }
  return $fetch;
};

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/config.mjs
var resolvePublicAuthUrl = (basePath) => {
  if (typeof process === "undefined")
    return;
  const path = basePath ?? "/api/auth";
  if (process.env.NEXT_PUBLIC_AUTH_URL)
    return process.env.NEXT_PUBLIC_AUTH_URL;
  if (typeof window === "undefined") {
    if (process.env.NEXTAUTH_URL)
      try {
        return process.env.NEXTAUTH_URL;
      } catch {}
    if (process.env.VERCEL_URL)
      try {
        const protocol = process.env.VERCEL_URL.startsWith("http") ? "" : "https://";
        return `${new URL(`${protocol}${process.env.VERCEL_URL}`).origin}${path}`;
      } catch {}
  }
};
var matchesSessionSignal = (path) => path === "/sign-out" || path === "/update-user" || path === "/update-session" || path === "/sign-up/email" || path === "/sign-in/email" || path === "/delete-user" || path === "/verify-email" || path === "/revoke-sessions" || path === "/revoke-session" || path === "/revoke-other-sessions" || path === "/change-email" || path === "/change-password";
var getClientConfig = (options, loadEnv) => {
  const isCredentialsSupported = "credentials" in Request.prototype;
  const baseURL = getBaseURL(options?.baseURL, options?.basePath, undefined, loadEnv) ?? resolvePublicAuthUrl(options?.basePath) ?? "/api/auth";
  const pluginsFetchPlugins = options?.plugins?.flatMap((plugin) => plugin.fetchPlugins).filter((pl) => pl !== undefined) || [];
  const lifeCyclePlugin = {
    id: "lifecycle-hooks",
    name: "lifecycle-hooks",
    hooks: {
      onSuccess: options?.fetchOptions?.onSuccess,
      onError: options?.fetchOptions?.onError,
      onRequest: options?.fetchOptions?.onRequest,
      onResponse: options?.fetchOptions?.onResponse
    }
  };
  const { onSuccess: _onSuccess, onError: _onError, onRequest: _onRequest, onResponse: _onResponse, ...restOfFetchOptions } = options?.fetchOptions || {};
  const $fetch = createFetch({
    baseURL,
    ...isCredentialsSupported ? { credentials: "include" } : {},
    method: "GET",
    jsonParser(text) {
      if (!text)
        return null;
      return parseJSON(text, { strict: false });
    },
    customFetchImpl: fetch,
    ...restOfFetchOptions,
    plugins: [
      lifeCyclePlugin,
      ...restOfFetchOptions.plugins || [],
      ...options?.disableDefaultFetchPlugins ? [] : [redirectPlugin],
      ...pluginsFetchPlugins
    ]
  });
  const { $sessionSignal, session, broadcastSessionUpdate } = getSessionAtom($fetch, options);
  let hasHydrated = false;
  const hydrateSession = (sessionData) => {
    if (hasHydrated || sessionData === null)
      return;
    hasHydrated = true;
    hydrateSessionAtom(session, sessionData);
  };
  const plugins = options?.plugins || [];
  let pluginsActions = {};
  const pluginsAtoms = {
    $sessionSignal,
    session
  };
  const pluginPathMethods = {
    "/sign-out": "POST",
    "/revoke-sessions": "POST",
    "/revoke-other-sessions": "POST",
    "/delete-user": "POST"
  };
  const atomListeners = [{
    signal: "$sessionSignal",
    matcher: matchesSessionSignal,
    callback(path) {
      if (path === "/sign-out")
        broadcastSessionUpdate("signout");
      else if (path === "/update-user" || path === "/update-session")
        broadcastSessionUpdate("updateUser");
    }
  }];
  for (const plugin of plugins) {
    if (plugin.getAtoms)
      Object.assign(pluginsAtoms, plugin.getAtoms?.($fetch));
    if (plugin.pathMethods)
      Object.assign(pluginPathMethods, plugin.pathMethods);
    if (plugin.atomListeners)
      atomListeners.push(...plugin.atomListeners);
  }
  const $store = {
    notify: (signal) => {
      pluginsAtoms[signal].set(!pluginsAtoms[signal].get());
    },
    listen: (signal, listener) => {
      pluginsAtoms[signal].subscribe(listener);
    },
    atoms: pluginsAtoms
  };
  for (const plugin of plugins)
    if (plugin.getActions)
      pluginsActions = defu(plugin.getActions?.($fetch, $store, options) ?? {}, pluginsActions);
  return {
    get baseURL() {
      return baseURL;
    },
    pluginsActions,
    pluginsAtoms,
    pluginPathMethods,
    atomListeners,
    hydrateSession,
    $sessionSignal,
    $fetch,
    $store
  };
};

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/utils/is-atom.mjs
function isAtom(value) {
  return typeof value === "object" && value !== null && "get" in value && typeof value.get === "function" && "lc" in value && typeof value.lc === "number";
}

// node_modules/.bun/@better-auth+core@1.7.13+3fbaf270a4e3f945/node_modules/@better-auth/core/dist/utils/string.mjs
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
var WORD_PATTERN = /[\p{Ll}\d]+|\p{Lu}+(?!\p{Ll})|\p{Lu}[\p{Ll}\d]+|\p{Lo}+/gu;
var APOSTROPHE_PATTERN = /['\u2019]/g;
function splitWords(input) {
  return input.replace(APOSTROPHE_PATTERN, "").match(WORD_PATTERN) ?? [];
}
function toKebabCase(input) {
  return splitWords(input).map((word) => word.toLowerCase()).join("-");
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/proxy.mjs
function getMethod2(path, knownPathMethods, args) {
  const method = knownPathMethods[path];
  const { fetchOptions, query: _query, ...body } = args || {};
  if (method)
    return method;
  if (fetchOptions?.method)
    return fetchOptions.method;
  if (body && Object.keys(body).length > 0)
    return "POST";
  return "GET";
}
function createDynamicPathProxy(routes, client, knownPathMethods, atoms, atomListeners) {
  function createProxy(path = []) {
    return new Proxy(function() {}, {
      get(_, prop) {
        if (typeof prop !== "string")
          return;
        if (prop === "then" || prop === "catch" || prop === "finally")
          return;
        const fullPath = [...path, prop];
        let current = routes;
        for (const segment of fullPath)
          if (current && typeof current === "object" && segment in current)
            current = current[segment];
          else {
            current = undefined;
            break;
          }
        if (typeof current === "function")
          return current;
        if (isAtom(current))
          return current;
        return createProxy(fullPath);
      },
      apply: async (_, __, args) => {
        const routePath = "/" + path.map(toKebabCase).join("/");
        const arg = args[0] || {};
        const fetchOptions = args[1] || {};
        const { query, fetchOptions: argFetchOptions, ...body } = arg;
        const options = {
          ...fetchOptions,
          ...argFetchOptions
        };
        const method = getMethod2(routePath, knownPathMethods, arg);
        return await client(routePath, {
          ...options,
          body: method === "GET" ? undefined : {
            ...body,
            ...options?.body || {}
          },
          query: query || options?.query,
          method,
          async onSuccess(context) {
            await options?.onSuccess?.(context);
            if (!atomListeners || options.disableSignal)
              return;
            const matches = atomListeners.filter((s) => s.matcher(routePath));
            if (!matches.length)
              return;
            const visited = /* @__PURE__ */ new Set;
            for (const match of matches) {
              const signal = atoms[match.signal];
              if (!signal)
                return;
              if (visited.has(match.signal))
                continue;
              visited.add(match.signal);
              const val = signal.get();
              setTimeout(() => {
                signal.set(!val);
              }, 10);
              match.callback?.(routePath);
            }
          }
        });
      }
    });
  }
  return createProxy();
}

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/client/vanilla.mjs
function createAuthClient(options) {
  const { pluginPathMethods, pluginsActions, pluginsAtoms, hydrateSession, $fetch, atomListeners, $store } = getClientConfig(options);
  const resolvedHooks = {};
  for (const [key, value] of Object.entries(pluginsAtoms))
    resolvedHooks[`use${capitalizeFirstLetter(key)}`] = value;
  const routes = {
    ...pluginsActions,
    ...resolvedHooks,
    hydrateSession,
    $fetch,
    $store
  };
  return createDynamicPathProxy(routes, $fetch, pluginPathMethods, pluginsAtoms, atomListeners);
}
// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/plugins/magic-link/client.mjs
var magicLinkClient = () => {
  return {
    id: "magic-link",
    version: PACKAGE_VERSION,
    $InferServerPlugin: {}
  };
};
// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/plugins/two-factor/error-code.mjs
var TWO_FACTOR_ERROR_CODES = defineErrorCodes({
  OTP_NOT_ENABLED: "OTP not enabled",
  OTP_NOT_CONFIGURED: "OTP is not available",
  OTP_HAS_EXPIRED: "OTP has expired",
  TOTP_NOT_ENABLED: "TOTP not enabled",
  TOTP_ALREADY_ENABLED: "TOTP is already enabled",
  TOTP_NOT_CONFIGURED: "TOTP is not available",
  TWO_FACTOR_NOT_ENABLED: "Two factor isn't enabled",
  BACKUP_CODES_NOT_ENABLED: "Backup codes aren't enabled",
  INVALID_BACKUP_CODE: "Invalid backup code",
  INVALID_CODE: "Invalid code",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many attempts. Please request a new code.",
  ACCOUNT_TEMPORARILY_LOCKED: "Too many failed verification attempts. Your account is temporarily locked. Please try again later.",
  INVALID_TWO_FACTOR_COOKIE: "Invalid two factor cookie"
});

// node_modules/.bun/better-auth@1.7.13+b320db59adc491bc/node_modules/better-auth/dist/plugins/two-factor/client.mjs
var twoFactorClient = (options) => {
  return {
    id: "two-factor",
    version: PACKAGE_VERSION,
    $InferServerPlugin: {},
    atomListeners: [{
      matcher: (path) => path.startsWith("/two-factor/"),
      signal: "$sessionSignal"
    }],
    pathMethods: {
      "/two-factor/disable": "POST",
      "/two-factor/enable": "POST",
      "/two-factor/send-otp": "POST",
      "/two-factor/generate-backup-codes": "POST",
      "/two-factor/get-totp-uri": "POST",
      "/two-factor/verify-totp": "POST",
      "/two-factor/verify-otp": "POST",
      "/two-factor/verify-backup-code": "POST"
    },
    fetchPlugins: [{
      id: "two-factor",
      name: "two-factor",
      hooks: { async onSuccess(context) {
        if (context.data?.twoFactorRedirect) {
          if (options?.onTwoFactorRedirect) {
            await options.onTwoFactorRedirect({ twoFactorMethods: context.data.twoFactorMethods });
            return;
          }
          if (options?.twoFactorPage && typeof window !== "undefined" && isSafeUrlScheme(options.twoFactorPage))
            window.location.href = options.twoFactorPage;
        }
      } }
    }],
    $ERROR_CODES: TWO_FACTOR_ERROR_CODES
  };
};
// node_modules/.bun/@better-auth+passkey@1.7.13+d9b9f4d13b183552/node_modules/@better-auth/passkey/dist/version-D57zofoH.mjs
var PASSKEY_ERROR_CODES = defineErrorCodes({
  CHALLENGE_NOT_FOUND: "Challenge not found",
  YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY: "You are not allowed to register this passkey",
  FAILED_TO_VERIFY_REGISTRATION: "Failed to verify registration",
  PASSKEY_NOT_FOUND: "Passkey not found",
  AUTHENTICATION_FAILED: "Authentication failed",
  UNABLE_TO_CREATE_SESSION: "Unable to create session",
  USER_NOT_FOUND: "User not found",
  FAILED_TO_UPDATE_PASSKEY: "Failed to update passkey",
  PREVIOUSLY_REGISTERED: "Previously registered",
  REGISTRATION_CANCELLED: "Registration cancelled",
  AUTH_CANCELLED: "Auth cancelled",
  UNKNOWN_ERROR: "Unknown error",
  SESSION_REQUIRED: "Passkey registration requires an authenticated session",
  RESOLVE_USER_REQUIRED: "Passkey registration requires either an authenticated session or a resolveUser callback when requireSession is false",
  RESOLVED_USER_INVALID: "Resolved user is invalid"
});
var PACKAGE_VERSION2 = "1.7.13";

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/bufferToBase64URLString.js
function bufferToBase64URLString(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/base64URLStringToBuffer.js
function base64URLStringToBuffer(base64URLString) {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - base64.length % 4) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0;i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthn.js
function browserSupportsWebAuthn() {
  return _browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== undefined && typeof globalThis.PublicKeyCredential === "function");
}
var _browserSupportsWebAuthnInternals = {
  stubThis: (value) => value
};

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/toPublicKeyCredentialDescriptor.js
function toPublicKeyCredentialDescriptor(descriptor) {
  const { id } = descriptor;
  return {
    ...descriptor,
    id: base64URLStringToBuffer(id),
    transports: descriptor.transports
  };
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/isValidDomain.js
function isValidDomain(hostname) {
  return hostname === "localhost" || /^((xn--[a-z0-9-]+|[a-z0-9]+(-[a-z0-9]+)*)\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(hostname);
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/webAuthnError.js
class WebAuthnError extends Error {
  constructor({ message, code, cause, name }) {
    super(message, { cause });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    this.name = name ?? cause.name;
    this.code = code;
  }
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/identifyRegistrationError.js
function identifyRegistrationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Registration ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "ConstraintError") {
    if (publicKey.authenticatorSelection?.requireResidentKey === true) {
      return new WebAuthnError({
        message: "Discoverable credentials were required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
        cause: error
      });
    } else if (options.mediation === "conditional" && publicKey.authenticatorSelection?.userVerification === "required") {
      return new WebAuthnError({
        message: "User verification was required during automatic registration but it could not be performed",
        code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
        cause: error
      });
    } else if (publicKey.authenticatorSelection?.userVerification === "required") {
      return new WebAuthnError({
        message: "User verification was required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
        cause: error
      });
    }
  } else if (error.name === "InvalidStateError") {
    return new WebAuthnError({
      message: "The authenticator was previously registered",
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      cause: error
    });
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "NotSupportedError") {
    const validPubKeyCredParams = publicKey.pubKeyCredParams.filter((param) => param.type === "public-key");
    if (validPubKeyCredParams.length === 0) {
      return new WebAuthnError({
        message: 'No entry in pubKeyCredParams was of type "public-key"',
        code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
        cause: error
      });
    }
    return new WebAuthnError({
      message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
      code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rp.id !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rp.id}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "TypeError") {
    if (publicKey.user.id.byteLength < 1 || publicKey.user.id.byteLength > 64) {
      return new WebAuthnError({
        message: "User ID was not between 1 and 64 characters",
        code: "ERROR_INVALID_USER_ID_LENGTH",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new credential",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/webAuthnAbortService.js
class BaseWebAuthnAbortService {
  constructor() {
    Object.defineProperty(this, "controller", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
  }
  createNewAbortSignal() {
    if (this.controller) {
      const abortError = new Error("Cancelling existing WebAuthn API call for new one");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
    }
    const newController = new AbortController;
    this.controller = newController;
    return newController.signal;
  }
  cancelCeremony() {
    if (this.controller) {
      const abortError = new Error("Manually cancelling existing WebAuthn API call");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
      this.controller = undefined;
    }
  }
}
var WebAuthnAbortService = new BaseWebAuthnAbortService;

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/toAuthenticatorAttachment.js
var attachments = ["cross-platform", "platform"];
function toAuthenticatorAttachment(attachment) {
  if (!attachment) {
    return;
  }
  if (attachments.indexOf(attachment) < 0) {
    return;
  }
  return attachment;
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/methods/startRegistration.js
async function startRegistration(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = { optionsJSON: options };
  }
  const { optionsJSON, useAutoRegister = false } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    user: {
      ...optionsJSON.user,
      id: base64URLStringToBuffer(optionsJSON.user.id)
    },
    excludeCredentials: optionsJSON.excludeCredentials?.map(toPublicKeyCredentialDescriptor)
  };
  const createOptions = {};
  if (useAutoRegister) {
    createOptions.mediation = "conditional";
  }
  createOptions.publicKey = publicKey;
  createOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.create(createOptions);
  } catch (err) {
    throw identifyRegistrationError({ error: err, options: createOptions });
  }
  if (!credential) {
    throw new Error("Registration was not completed");
  }
  const { id, rawId, response, type } = credential;
  let transports = undefined;
  if (typeof response.getTransports === "function") {
    transports = response.getTransports();
  }
  let responsePublicKeyAlgorithm = undefined;
  if (typeof response.getPublicKeyAlgorithm === "function") {
    try {
      responsePublicKeyAlgorithm = response.getPublicKeyAlgorithm();
    } catch (error) {
      warnOnBrokenImplementation("getPublicKeyAlgorithm()", error);
    }
  }
  let responsePublicKey = undefined;
  if (typeof response.getPublicKey === "function") {
    try {
      const _publicKey = response.getPublicKey();
      if (_publicKey !== null) {
        responsePublicKey = bufferToBase64URLString(_publicKey);
      }
    } catch (error) {
      warnOnBrokenImplementation("getPublicKey()", error);
    }
  }
  let responseAuthenticatorData;
  if (typeof response.getAuthenticatorData === "function") {
    try {
      responseAuthenticatorData = bufferToBase64URLString(response.getAuthenticatorData());
    } catch (error) {
      warnOnBrokenImplementation("getAuthenticatorData()", error);
    }
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      attestationObject: bufferToBase64URLString(response.attestationObject),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      transports,
      publicKeyAlgorithm: responsePublicKeyAlgorithm,
      publicKey: responsePublicKey,
      authenticatorData: responseAuthenticatorData
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}
function warnOnBrokenImplementation(methodName, cause) {
  console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${methodName}. You should report this error to them.
`, cause);
}
// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthnAutofill.js
function browserSupportsWebAuthnAutofill() {
  if (!browserSupportsWebAuthn()) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  const globalPublicKeyCredential = globalThis.PublicKeyCredential;
  if (globalPublicKeyCredential?.isConditionalMediationAvailable === undefined) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  return _browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
}
var _browserSupportsWebAuthnAutofillInternals = {
  stubThis: (value) => value
};

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/helpers/identifyAuthenticationError.js
function identifyAuthenticationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Authentication ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rpId !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rpId}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// node_modules/.bun/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/methods/startAuthentication.js
async function startAuthentication(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = { optionsJSON: options };
  }
  const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  let allowCredentials;
  if (optionsJSON.allowCredentials?.length !== 0) {
    allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor);
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    allowCredentials
  };
  const getOptions = {};
  if (useBrowserAutofill) {
    if (!await browserSupportsWebAuthnAutofill()) {
      throw Error("Browser does not support WebAuthn autofill");
    }
    const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
    if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
      throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
    }
    getOptions.mediation = "conditional";
    publicKey.allowCredentials = [];
  }
  getOptions.publicKey = publicKey;
  getOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.get(getOptions);
  } catch (err) {
    throw identifyAuthenticationError({ error: err, options: getOptions });
  }
  if (!credential) {
    throw new Error("Authentication was not completed");
  }
  const { id, rawId, response, type } = credential;
  let userHandle = undefined;
  if (response.userHandle) {
    userHandle = bufferToBase64URLString(response.userHandle);
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}
// node_modules/.bun/@better-auth+passkey@1.7.13+d9b9f4d13b183552/node_modules/@better-auth/passkey/dist/client.mjs
var getPasskeyActions = ($fetch, { $listPasskeys, $store }) => {
  const signInPasskey = async (opts, options) => {
    const response = await $fetch("/passkey/generate-authenticate-options", {
      method: "GET",
      throw: false
    });
    if (!response.data)
      return response;
    const mergedExtensions = response.data.extensions || opts?.extensions ? {
      ...response.data.extensions || {},
      ...opts?.extensions || {}
    } : undefined;
    let res;
    try {
      res = await startAuthentication({
        optionsJSON: {
          ...response.data,
          extensions: mergedExtensions
        },
        useBrowserAutofill: opts?.autoFill
      });
    } catch (err) {
      return {
        data: null,
        error: {
          code: err instanceof WebAuthnError ? err.code : "AUTH_CANCELLED",
          message: PASSKEY_ERROR_CODES.AUTH_CANCELLED.message,
          status: 400,
          statusText: "BAD_REQUEST"
        }
      };
    }
    try {
      const { clientExtensionResults, ...responseBody } = res;
      const verified = await $fetch("/passkey/verify-authentication", {
        body: { response: responseBody },
        ...opts?.fetchOptions,
        ...options,
        method: "POST",
        throw: false
      });
      $listPasskeys.set(Math.random());
      $store.notify("$sessionSignal");
      if (opts?.returnWebAuthnResponse)
        return {
          ...verified,
          webauthn: {
            response: res,
            clientExtensionResults
          }
        };
      return verified;
    } catch (err) {
      console.error(`[Better Auth] Error verifying passkey`, err);
      return {
        data: null,
        error: {
          code: "AUTH_CANCELLED",
          message: PASSKEY_ERROR_CODES.AUTH_CANCELLED.message,
          status: 400,
          statusText: "BAD_REQUEST"
        }
      };
    }
  };
  const registerPasskey = async (opts, fetchOpts) => {
    const options = await $fetch("/passkey/generate-register-options", {
      method: "GET",
      query: {
        ...opts?.authenticatorAttachment && { authenticatorAttachment: opts.authenticatorAttachment },
        ...opts?.name && { name: opts.name },
        ...opts?.context && { context: opts.context }
      },
      throw: false
    });
    if (!options.data)
      return options;
    try {
      const mergedExtensions = options.data.extensions || opts?.extensions ? {
        ...options.data.extensions || {},
        ...opts?.extensions || {}
      } : undefined;
      const res = await startRegistration({
        optionsJSON: {
          ...options.data,
          extensions: mergedExtensions
        },
        useAutoRegister: opts?.useAutoRegister
      });
      const { clientExtensionResults, ...responseBody } = res;
      const verified = await $fetch("/passkey/verify-registration", {
        ...opts?.fetchOptions,
        ...fetchOpts,
        body: {
          response: responseBody,
          name: opts?.name,
          ...opts?.createSession && { createSession: true }
        },
        method: "POST",
        throw: false
      });
      if (!verified.data)
        return verified;
      $listPasskeys.set(Math.random());
      if (verified.data.session)
        $store.notify("$sessionSignal");
      if (opts?.returnWebAuthnResponse)
        return {
          ...verified,
          webauthn: {
            response: res,
            clientExtensionResults
          }
        };
      return verified;
    } catch (e) {
      if (e instanceof WebAuthnError) {
        if (e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
          return {
            data: null,
            error: {
              code: e.code,
              message: PASSKEY_ERROR_CODES.PREVIOUSLY_REGISTERED.message,
              status: 400,
              statusText: "BAD_REQUEST"
            }
          };
        if (e.code === "ERROR_CEREMONY_ABORTED")
          return {
            data: null,
            error: {
              code: e.code,
              message: PASSKEY_ERROR_CODES.REGISTRATION_CANCELLED.message,
              status: 400,
              statusText: "BAD_REQUEST"
            }
          };
        return {
          data: null,
          error: {
            code: e.code,
            message: e.message,
            status: 400,
            statusText: "BAD_REQUEST"
          }
        };
      }
      return {
        data: null,
        error: {
          code: "UNKNOWN_ERROR",
          message: e instanceof Error ? e.message : PASSKEY_ERROR_CODES.UNKNOWN_ERROR.message,
          status: 500,
          statusText: "INTERNAL_SERVER_ERROR"
        }
      };
    }
  };
  return {
    signIn: {
      passkey: signInPasskey
    },
    passkey: {
      addPasskey: registerPasskey
    },
    $Infer: {}
  };
};
var passkeyClient = () => {
  const $listPasskeys = atom();
  return {
    id: "passkey",
    version: PACKAGE_VERSION2,
    $InferServerPlugin: {},
    getActions: ($fetch, $store) => getPasskeyActions($fetch, {
      $listPasskeys,
      $store
    }),
    getAtoms($fetch) {
      return {
        listPasskeys: useAuthQuery($listPasskeys, "/passkey/list-user-passkeys", $fetch, { method: "GET" }),
        $listPasskeys
      };
    },
    pathMethods: {
      "/passkey/register": "POST",
      "/passkey/authenticate": "POST"
    },
    atomListeners: [{
      matcher(path) {
        return path === "/passkey/verify-registration" || path === "/passkey/delete-passkey" || path === "/passkey/update-passkey" || path === "/sign-out";
      },
      signal: "$listPasskeys"
    }, {
      matcher: (path) => path === "/passkey/verify-authentication",
      signal: "$sessionSignal"
    }],
    $ERROR_CODES: PASSKEY_ERROR_CODES
  };
};

// packages/sdk-js/src/index.ts
function createClient(options) {
  return new QBClient(options);
}

class QBClient {
  options;
  baseURL;
  scope;
  token = null;
  session = null;
  listeners = new Set;
  refreshPromise = null;
  channels = new Set;
  disposed = false;
  epoch = 0;
  pending = new Set;
  betterAuthClient = null;
  constructor(options) {
    this.options = options;
    let url;
    try {
      url = new URL(options.url);
    } catch {
      throw new QBError("CONFIG", "Use an absolute HTTP(S) API URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new QBError("CONFIG", "Use an HTTP(S) API URL without credentials, query parameters or fragments");
    this.baseURL = `${options.url.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(options.projectId)}/branches/${encodeURIComponent(options.branch ?? "primary")}`;
    this.scope = `${options.url}/${options.projectId}/${options.branch ?? "primary"}`;
  }
  getSession() {
    return this.session;
  }
  authClient() {
    if (!this.betterAuthClient) {
      const client = this;
      this.betterAuthClient = createAuthClient({
        baseURL: this.baseURL + "/auth",
        plugins: [passkeyClient(), twoFactorClient(), magicLinkClient()],
        fetchOptions: {
          customFetchImpl: async (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set("x-qb-key", client.options.publishableKey);
            if (client.token)
              headers.set("authorization", `Bearer ${client.token}`);
            const response = await (client.options.fetch ?? globalThis.fetch)(input, {
              ...init,
              headers,
              credentials: client.options.credentials ?? "include"
            });
            const rotated = response.headers.get("set-auth-token");
            if (rotated)
              client.token = rotated;
            return response;
          }
        }
      });
    }
    return this.betterAuthClient;
  }
  getIdentityVersion() {
    return this.epoch;
  }
  getToken() {
    return this.token;
  }
  onAuthStateChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setSession(session, token) {
    const before = this.session?.user.id;
    this.session = session;
    if (token !== undefined)
      this.token = token;
    if (before !== session?.user.id) {
      this.epoch++;
      for (const pending of this.pending)
        pending.abort(new QBError("IDENTITY_CHANGED", "Application identity changed", 499));
      for (const channel of this.channels)
        channel.reauthenticate();
    }
    for (const listener of this.listeners)
      listener(session);
  }
  async request(path, method = "GET", body, options = {}) {
    if (this.disposed)
      throw new QBError("DISPOSED", "Client has been disposed");
    const fetcher = this.options.fetch ?? globalThis.fetch;
    let attempt = 0;
    let currentSignal, currentTimeout;
    const cancellation = new AbortController;
    this.pending.add(cancellation);
    try {
      while (true) {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
        const signal = AbortSignal.any([
          timeout,
          cancellation.signal,
          ...options.signal ? [options.signal] : []
        ]);
        currentSignal = signal;
        currentTimeout = timeout;
        const headers = {
          "x-qb-key": this.options.publishableKey,
          "x-request-id": crypto.randomUUID()
        };
        if (this.token)
          headers.authorization = `Bearer ${this.token}`;
        if (options.idempotencyKey)
          headers["idempotency-key"] = options.idempotencyKey;
        if (options.revision !== undefined)
          headers["if-match"] = String(options.revision);
        const binary = typeof Blob !== "undefined" && body instanceof Blob || body instanceof Uint8Array;
        if (body !== undefined && !binary)
          headers["content-type"] = "application/json";
        let response;
        try {
          response = await fetcher(this.baseURL + path, {
            method,
            headers,
            signal,
            credentials: this.options.credentials ?? "include",
            body: body === undefined ? undefined : binary ? body : JSON.stringify(body)
          });
        } catch (error) {
          if (signal.aborted)
            throw new QBError(timeout.aborted ? "TIMEOUT" : "ABORTED", timeout.aborted ? "Request timed out" : "Request was cancelled", timeout.aborted ? 408 : 499, timeout.aborted);
          if ((method === "GET" || options.safe || options.idempotencyKey) && attempt++ < 2) {
            await this.delay(attempt, signal);
            continue;
          }
          throw new QBError("NETWORK", "Unable to reach QB Flex", 0, true);
        }
        const rotated = response.headers.get("set-auth-token");
        if (rotated)
          this.token = rotated;
        if (response.ok) {
          if (options.raw)
            return await response.blob();
          if (response.status === 204)
            return;
          return await response.json();
        }
        if (response.status === 401 && !options.auth && options.refresh !== false && this.token && attempt++ === 0) {
          if (await this.auth.refreshSession())
            continue;
        }
        const value = await response.json().catch(() => null);
        const error = new QBError(value?.error?.code ?? value?.code ?? "REQUEST_FAILED", value?.error?.message ?? value?.message ?? `Request failed (${response.status})`, response.status, value?.error?.retryable ?? false, value?.error?.details);
        if (error.retryable && (method === "GET" || options.safe || options.idempotencyKey) && attempt++ < 2) {
          await this.delay(attempt, signal);
          continue;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof QBError)
        throw error;
      if (currentSignal?.aborted)
        throw new QBError(currentTimeout?.aborted ? "TIMEOUT" : "ABORTED", currentTimeout?.aborted ? "Request timed out" : "Request was cancelled", currentTimeout?.aborted ? 408 : 499, !!currentTimeout?.aborted);
      throw new QBError("PROTOCOL", "QB Flex returned an invalid response", 502);
    } finally {
      this.pending.delete(cancellation);
    }
  }
  delay(attempt, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, Math.min(1000, 100 * 2 ** attempt) + Math.random() * 100);
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      if (signal?.aborted)
        abort();
      else
        signal?.addEventListener("abort", abort, { once: true });
    });
  }
  from(table) {
    return new QueryBuilder(this, table, {});
  }
  auth = {
    signUp: async (input) => {
      const result = await this.request("/auth/sign-up/email", "POST", input, { auth: true });
      const session = result.token ? { user: result.user, token: result.token } : null;
      this.setSession(session, result.token ?? null);
      return session;
    },
    signIn: async (input) => {
      const result = await this.request("/auth/sign-in/email", "POST", input, { auth: true });
      if (result.twoFactorRedirect)
        throw new QBError("MFA_REQUIRED", "Complete two-factor authentication");
      const session = { user: result.user, token: result.token };
      this.setSession(session, result.token ?? this.token);
      return session;
    },
    signInWithMagicLink: async (email, options) => {
      const callbackURL = options?.callbackURL ?? options?.redirectTo;
      return this.request("/auth/sign-in/magic-link", "POST", callbackURL ? { email, callbackURL } : { email }, { auth: true });
    },
    signOut: async () => {
      await this.request("/auth/sign-out", "POST", {}, { auth: true });
      this.setSession(null, null);
    },
    passkey: {
      enroll: async (opts) => {
        const result = await this.authClient().passkey.addPasskey(opts);
        if (result.error)
          throw new QBError("PASSKEY_FAILED", result.error.message ?? "Passkey registration failed", result.error.status);
        return result.data;
      },
      list: async () => {
        const result = await this.authClient().$fetch("/passkey/list-user-passkeys");
        if (result.error)
          throw new QBError("PASSKEY_FAILED", result.error.message ?? "Unable to list passkeys", result.error.status);
        return result.data ?? [];
      },
      remove: async (id) => {
        const result = await this.authClient().$fetch("/passkey/delete-passkey", {
          method: "POST",
          body: { id }
        });
        if (result.error)
          throw new QBError("PASSKEY_FAILED", result.error.message ?? "Unable to remove passkey", result.error.status);
      },
      rename: async (id, name) => {
        const result = await this.authClient().$fetch("/passkey/update-passkey", {
          method: "POST",
          body: { id, name }
        });
        if (result.error)
          throw new QBError("PASSKEY_FAILED", result.error.message ?? "Unable to rename passkey", result.error.status);
      },
      signIn: async () => {
        const result = await this.authClient().signIn.passkey();
        if (result.error)
          throw new QBError("PASSKEY_FAILED", result.error.message ?? "Passkey sign-in failed", result.error.status);
        const payload = result.data;
        const session = payload?.user ? { user: payload.user, token: payload.token ?? null } : null;
        this.setSession(session, payload?.token ?? null);
        return session;
      }
    },
    twoFactor: {
      enable: async (password) => {
        const result = await this.request("/auth/two-factor/enable", "POST", { password }, { auth: true });
        return {
          totpURI: result.totpURI,
          backupCodes: result.backupCodes ?? []
        };
      },
      verify: async (code) => {
        await this.request("/auth/two-factor/verify-totp", "POST", { code }, { auth: true });
      },
      disable: async (password) => {
        await this.request("/auth/two-factor/disable", "POST", { password }, { auth: true });
      }
    },
    refreshSession: async () => {
      if (this.refreshPromise)
        return this.refreshPromise;
      this.refreshPromise = (async () => {
        try {
          const result = await this.request("/auth/get-session", "GET", undefined, {
            auth: true,
            refresh: false
          });
          if (!result?.user) {
            this.setSession(null, null);
            return null;
          }
          const session = { user: result.user, expiresAt: result.session.expiresAt };
          this.setSession(session, this.token ?? result.session.token);
          return session;
        } catch (error) {
          if (error instanceof QBError && (error.status === 401 || error.code === "ABORTED" || error.code === "IDENTITY_CHANGED" || error.code === "DISPOSED")) {
            this.setSession(null, null);
            return null;
          }
          throw error;
        } finally {
          this.refreshPromise = null;
        }
      })();
      return this.refreshPromise;
    },
    resetPassword: async (email, redirectTo) => this.request("/auth/request-password-reset", "POST", { email, redirectTo }, { auth: true }),
    updatePassword: async (token, newPassword) => this.request("/auth/reset-password", "POST", { token, newPassword }, { auth: true }),
    sendVerification: async (email, callbackURL) => this.request("/auth/send-verification-email", "POST", { email, callbackURL }, { auth: true }),
    signInWithProvider: async (provider, callbackURL) => this.request("/auth/sign-in/social", "POST", { provider, callbackURL }, { auth: true })
  };
  rpc(operation, args, options = {}) {
    return this.request(`/rpc/${encodeURIComponent(operation)}`, "POST", args, options);
  }
  search(input, options = {}) {
    return this.request("/search", "POST", input, options);
  }
  channel(options) {
    const channel = new QBChannel(this, options, () => this.channels.delete(channel));
    this.channels.add(channel);
    return channel;
  }
  storage = {
    listBuckets: () => this.request("/storage/buckets"),
    list: (bucket) => this.request(`/storage/buckets/${encodeURIComponent(bucket)}/objects`),
    upload: async (bucket, key, file, options = {}) => {
      const intent = await this.request(`/storage/buckets/${encodeURIComponent(bucket)}/objects`, "POST", {
        key,
        size: file.size,
        mime: file.type || "application/octet-stream",
        ...options.checksum ? { checksum: options.checksum } : {}
      }, options);
      return this.request(`/storage/objects/${intent.data.id}/content`, "PUT", file, options);
    },
    download: (id, options = {}) => this.request(`/storage/objects/${encodeURIComponent(id)}/content`, "GET", undefined, {
      ...options,
      raw: true
    }),
    remove: (id, options = {}) => this.request(`/storage/objects/${encodeURIComponent(id)}`, "DELETE", undefined, options)
  };
  dispose() {
    this.disposed = true;
    for (const pending of this.pending)
      pending.abort();
    this.pending.clear();
    for (const channel of [...this.channels])
      channel.unsubscribe();
    this.listeners.clear();
    this.token = null;
    this.session = null;
  }
}

class QueryBuilder {
  client;
  table;
  query;
  options;
  constructor(client, table, query, options = {}) {
    this.client = client;
    this.table = table;
    this.query = query;
    this.options = options;
  }
  next(query) {
    return new QueryBuilder(this.client, this.table, { ...this.query, ...query }, this.options);
  }
  select(columns) {
    return new QueryBuilder(this.client, this.table, { ...this.query, columns }, this.options);
  }
  filter(column, op, value) {
    return this.next({ filters: [...this.query.filters ?? [], { column, op, value }] });
  }
  eq(column, value) {
    return this.filter(column, "eq", value);
  }
  order(column, direction = "asc") {
    return this.next({ order: [...this.query.order ?? [], { column, direction }] });
  }
  limit(limit) {
    return this.next({ limit });
  }
  cursor(cursor) {
    return this.next({ cursor });
  }
  include(relations) {
    return new QueryBuilder(this.client, this.table, { ...this.query, relations }, this.options);
  }
  count() {
    return this.next({ count: true });
  }
  groupBy(columns) {
    return this.next({ groupBy: columns });
  }
  aggregate(fn, column, alias) {
    const generatedAlias = alias ?? `${fn}_${String(column ?? "star")}`;
    return this.next({
      aggregates: [
        ...this.query.aggregates ?? [],
        { fn, column, alias: generatedAlias }
      ]
    });
  }
  having(alias, op, value) {
    return this.next({
      having: [...this.query.having ?? [], { alias, op, value }]
    });
  }
  abortSignal(signal) {
    return new QueryBuilder(this.client, this.table, this.query, {
      ...this.options,
      signal
    });
  }
  execute() {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/query`, "POST", this.query, { ...this.options, safe: true });
  }
  then(fulfilled, rejected) {
    return this.execute().then(fulfilled, rejected);
  }
  insert(row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}`, "POST", row, options);
  }
  upsert(row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/upsert`, "POST", row, options);
  }
  update(key, row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`, "PATCH", row, options);
  }
  delete(key, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`, "DELETE", undefined, options);
  }
}
function encodeKey(key) {
  if (!Array.isArray(key))
    return String(key);
  const bytes = new TextEncoder().encode(JSON.stringify(key));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

class QBChannel {
  client;
  options;
  onDispose;
  socket = null;
  stopped = true;
  retry = 0;
  timer;
  heartbeat;
  cursor;
  seen = new Set;
  constructor(client, options, onDispose) {
    this.client = client;
    this.options = options;
    this.onDispose = onDispose;
    this.cursor = options.cursor;
  }
  subscribe() {
    if (!this.stopped)
      return this;
    this.stopped = false;
    this.connect();
    return this;
  }
  connect() {
    if (this.stopped)
      return;
    this.options.onStatus?.("connecting");
    const socket = new WebSocket(this.client.baseURL.replace(/^http/, "ws") + "/realtime");
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket)
        return;
      socket.send(JSON.stringify({
        type: "join",
        table: this.options.table,
        publishableKey: this.client.options.publishableKey,
        token: this.client.getToken(),
        cursor: this.cursor
      }));
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "heartbeat" }));
      }, 25000);
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket || this.stopped)
        return;
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === "joined") {
        this.retry = 0;
        this.options.onStatus?.("connected");
      } else if (event.type === "cursor")
        this.cursor = event.cursor;
      else if (event.type === "database") {
        if (this.seen.has(event.eventId))
          return;
        this.seen.add(event.eventId);
        if (this.seen.size > 1000)
          this.seen.delete(this.seen.values().next().value);
        this.options.onEvent(event);
      } else if (event.code === "RESYNC_REQUIRED") {
        this.cursor = undefined;
        this.options.onResync?.();
      } else if (event.type === "error")
        this.options.onStatus?.(event.code === "UNAUTHORIZED" ? "unauthorized" : "error");
    };
    socket.onclose = (event) => {
      if (this.socket !== socket)
        return;
      if (this.heartbeat)
        clearInterval(this.heartbeat);
      if (this.stopped)
        return;
      if (event.code === 4001) {
        this.options.onStatus?.("unauthorized");
        return;
      }
      this.options.onStatus?.("reconnecting");
      this.timer = setTimeout(() => this.connect(), Math.min(30000, 500 * 2 ** this.retry++) + Math.random() * 300);
    };
  }
  reauthenticate() {
    if (this.stopped)
      return;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    if (this.timer)
      clearTimeout(this.timer);
    if (this.heartbeat)
      clearInterval(this.heartbeat);
    this.cursor = undefined;
    this.seen.clear();
    this.connect();
  }
  unsubscribe() {
    this.stopped = true;
    if (this.timer)
      clearTimeout(this.timer);
    if (this.heartbeat)
      clearInterval(this.heartbeat);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    this.socket = null;
    this.options.onStatus?.("disconnected");
    this.onDispose();
  }
}
export {
  QBChannel,
  QBClient,
  QBError,
  QueryBuilder,
  createClient
};

//# debugId=A6614A921BCE87D064756E2164756E21
