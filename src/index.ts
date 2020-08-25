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
        let event = data.event === "delete" ? "change" : data.event;
        pEvent?.trigger(event, {
            ...data,
            path: [key, ...data.path]
        });
    }
    event?.on("*", callback);
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
    event?.off("*", callback);
}

export interface EventData {
    path: string[];
    value: any;
    oldValue: any;
    event: string;
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
    private events = new Map<string, Function[]>();

    on(event: string, callback: (...args: any[]) => void) {
        let callbacks = this.events.get(event);
        if (!callbacks) {
            callbacks = [];
            this.events.set(event, callbacks);
        }
        callbacks.push(callback);
    }
    off(event: string, callback: Function) {
        let callbacks = this.events.get(event);
        if (!callbacks) return;

        let index = callbacks.indexOf(callback);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
    }
    trigger(event: string, ...args: any[]) {
        let callbacks = [
            ...this.events.get(event) ?? [],
            ...this.events.get("*") ?? []
        ];

        for (let cb of callbacks) {
            cb(...args);
        }
    }
}

class InnerWatcher extends Watcher {
    static readonly innerEvent = new Watcher();
    trigger(event: string, ...args: any[]) {
        super.trigger(event, ...args);
        InnerWatcher.innerEvent.trigger(event, this, ...args);
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
            event?.trigger("change", {
                path: ["length"],
                value: newLength,
                oldValue: oldLength,
                event: "change"
            });
        }
    }
}

function proxyFactory<T extends object>(obj: T): T {
    return new Proxy(obj, {
        enumerate(obj) {
            let value = obj;
            let event = eventMap.get(obj);
            event?.trigger("get", {
                path: [],
                value,
                oldValue: value,
                event: "get"
            });

            let res = Reflect.enumerate(obj);
            return Array.from(res);
        },
        has(obj: any, key) {
            let value = obj[key];
            let event = eventMap.get(obj);
            event?.trigger("get", {
                path: [key],
                value,
                oldValue: value,
                event: "get"
            });

            let res = Reflect.has(obj, key);
            return res;
        },
        get(obj: any, key) {
            let value = obj[key];
            let event = eventMap.get(obj);
            event?.trigger("get", {
                path: [key],
                value,
                oldValue: value,
                event: "get"
            });

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
                event?.trigger("change", {
                    path: [key],
                    value,
                    oldValue,
                    event: "change"
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
                event?.trigger("change", {
                    path: [key],
                    value: undefined,
                    oldValue,
                    event: "delete"
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

    let pEvent = new InnerWatcher();
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
    e?.on("change", callback);
}

export function unwatch(obj: object, callback: Function) {
    let target = getTarget(obj);
    let e = eventMap.get(target);
    e?.off("change", callback);
}

export function dirtyWatch<T extends Function>(useCache: boolean, fn: T): [T, Watcher] {
    let dependencies: Watcher[] = [];
    let isDirty = true;
    let cache: any;
    let timer: number;

    let watcher = new Watcher();
    function callback() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            isDirty = true;
            watcher.trigger("change");
        });
    }

    function depCollect(dep: Watcher) {
        dependencies.push(dep);
    }

    return [
        function (...args: any[]) {
            if (useCache && !isDirty) return cache;

            for (let dep of dependencies) {
                dep.off("change", callback);
            }
            dependencies = [];

            InnerWatcher.innerEvent.on("get", depCollect);
            cache = fn(...args);
            isDirty = false;
            InnerWatcher.innerEvent.off("get", depCollect);

            for (let dep of dependencies) {
                dep.on("change", callback);
            }

            return cache;
        } as any,
        watcher
    ];
}