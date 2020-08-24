type proxyObject = object;
type pEventEmitter = Watcher;

let proxyMap = new WeakMap<object, proxyObject>();
let eventMap = new WeakMap<object | Array<any>, Watcher>();
let objectMap = new WeakMap<proxyObject, object | Array<any>>();
let pipeMap = new WeakMap<pEventEmitter, Map<string | number | symbol, Function>>();

function pipe(pObj: object, obj: object, key: string | number | symbol) {
    let pEvent = eventMap.get(pObj)!;
    let event = eventMap.get(obj);
    function callback(data: EventData): void {
        pEvent?.trigger({
            ...data,
            path: [key, ...data.path]
        });
    }
    event?.on(callback);
    let map = pipeMap.get(pEvent);
    if (!map) {
        map = new Map();
        pipeMap.set(pEvent, map);
    }
    map.set(key, callback);
}

function unpipe(pObj: object, obj: object, key: string | number | symbol) {
    let pEvent = eventMap.get(pObj)!;
    let event = eventMap.get(obj);
    let map = pipeMap.get(pEvent);
    let callback = map?.get(key)!;
    event?.off(callback);
}

export interface EventData {
    path: string[];
    value: any;
    oldValue: any;
    isDelete: boolean;
}

function isProxyArrayMethods(obj: any, key: string | number | symbol) {
    let proxyMethods = ["pop", "push", "shift", "unshift"];
    let isArray = Array.isArray(obj);
    let needProxy = proxyMethods.includes(key as string);
    let isMethod = typeof obj[key] === "function";
    return isArray && needProxy && isMethod;
}

function isObject(obj: any): obj is object {
    return Object.prototype.toString.call(obj) === "[object Object]";
}

function isObservable(obj: any): obj is object | Array<any> {
    return isObject(obj) || Array.isArray(obj);
}

export class Watcher {
    private static callbacks: Function[] = [];
    static on(callback: (cb: Watcher, ...args: any[]) => void) {
        this.callbacks.push(callback);
    }
    static off(callback: Function) {
        let index = this.callbacks.indexOf(callback);
        if (index !== -1) {
            this.callbacks.splice(index, 1);
        }
    }
    private static trigger(cb: Watcher, ...args: any[]) {
        for (let cb of this.callbacks) {
            cb(cb, ...args);
        }
    }

    private callbacks: Function[] = [];
    on(callback: (...args: any[]) => void) {
        this.callbacks.push(callback);
    }
    off(callback: Function) {
        let index = this.callbacks.indexOf(callback);
        if (index !== -1) {
            this.callbacks.splice(index, 1);
        }
    }
    trigger(...args: any[]) {
        for (let cb of this.callbacks) {
            cb(...args);
        }
        Watcher.trigger(this, ...args);
    }
}

function emitLengthFn(fn: Function) {
    return function (this: any, ...args: any[]) {
        let value = objectMap.get(this) as Array<any>;
        let oldValue = [...value];

        fn.apply(this, args);

        let oldLength = oldValue.length;
        let newLength = value.length;
        if (oldLength !== newLength) {
            let event = eventMap.get(value);
            event?.trigger({
                path: ["length"],
                value: newLength,
                oldValue: oldLength,
                isDelete: false
            });
        }
    }
}

function proxyFactory<T extends object>(obj: T): T {
    return new Proxy(obj, {
        enumerate(obj) {
            let res = Reflect.enumerate(obj);
            return Array.from(res);
        },
        has(obj, key) {
            let res = Reflect.has(obj, key);
            return res;
        },
        get(obj: any, key) {
            let res = Reflect.get(obj, key);
            if (isObservable(res)) {
                res = proxyMap.get(res);
            }

            let needProxy = isProxyArrayMethods(obj, key);
            if (needProxy) {
                let fn = obj[key];
                res = emitLengthFn(fn);
            }

            return res;
        },
        set(obj: any, key, value) {
            let oldValue = obj[key];
            if (isObservable(value)) {
                let object = objectMap.get(value);
                if (object) {
                    value = object;
                } else {
                    observable(value);
                }
            }

            // todo, array set length时要特殊处理

            let res = Reflect.set(obj, key, value);
            if (oldValue === value) return res;

            if (res) {
                if (isObservable(oldValue)) {
                    unpipe(obj, oldValue, key);
                }

                if (isObservable(value)) {
                    pipe(obj, value, key);
                }

                let event = eventMap.get(obj);
                event?.trigger({
                    path: [key],
                    value,
                    oldValue,
                    isDelete: false
                });
            }
            return res;
        },
        deleteProperty(obj: any, key) {
            let oldValue = obj[key];
            let res = Reflect.deleteProperty(obj, key);
            if (res) {
                if (isObservable(oldValue)) {
                    unpipe(obj, oldValue, key);
                }

                let event = eventMap.get(obj);
                event?.trigger({
                    path: [key],
                    value: undefined,
                    oldValue,
                    isDelete: true
                });
            }
            return res;
        }
    });
}

export function observable<T extends object>(obj: T): T {
    if (!isObservable(obj)) throw new Error();

    let res = proxyMap.get(obj);
    if (res) return res as T;

    let proxy = proxyFactory(obj);
    proxyMap.set(obj, proxy);
    objectMap.set(proxy, obj);

    let pEvent = new Watcher();
    eventMap.set(obj, pEvent);
    for (let key in obj) {
        let value = obj[key];
        if (isObservable(value)) {
            observable(value);
            pipe(obj, value, key);
        }
    }

    return proxy;
}

function getTarget(obj: object) {
    if (!isObservable(obj)) throw new TypeError("obj need to be object or array.");

    let target = objectMap.get(obj);
    if (!target) throw new Error("obj shoule be a observable object, use function observable to wrap it.");

    return target;
}

export function watch(obj: object, callback: (data: EventData) => void) {
    let target = getTarget(obj);
    let e = eventMap.get(target);
    e?.on(callback);
}

export function unwatch(obj: object, callback: Function) {
    let target = getTarget(obj);
    let e = eventMap.get(target);
    e?.off(callback);
}

export function dirtyWatch<T extends Function>(fn: T): { watcher: Watcher, fn: T } {
    let dependencies: Watcher[] = [];

    let watcher = new Watcher();
    function callback() {
        watcher.trigger();
    }

    return {
        watcher,
        fn: function (...args: any[]) {
            for (let dep of dependencies) {
                dep.off(callback);
            }
            dependencies = [];

            Watcher.on(function (dep) {
                dependencies.push(dep);
                dep.on(callback)
            });

            return fn(...args);

        } as any
    };
}