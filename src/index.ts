type proxyObject = object;
type pEventEmitter = EventEmitter;

let proxyMap = new WeakMap<object, proxyObject>();
let eventMap = new WeakMap<object | Array<any>, EventEmitter>();
let objectMap = new WeakMap<proxyObject, object | Array<any>>();
let pipeMap = new WeakMap<pEventEmitter, Map<string | number | symbol, Function>>();

function pipe(pObj: object, obj: object, key: string | number | symbol) {
    let pEvent = eventMap.get(pObj)!;
    let event = eventMap.get(obj);
    let callback = function (event: string, data: EventData): void {
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
    event: string;
    path: string[];
    value: any;
    oldValue: any;
}

function isProxyArrayMethods(obj: any, key: string | number | symbol) {
    let prxoyMethods = ["pop", "push", "shift", "unshift"];
    let isArray = Array.isArray(obj);
    let needPrxoy = prxoyMethods.includes(key as string);
    let isMethod = typeof obj[key] === "function";
    return isArray && needPrxoy && isMethod;
}

function isObject(obj: any): obj is object {
    return Object.prototype.toString.call(obj) === "[object Object]";
}

function isObservable(obj: any): obj is object | Array<any> {
    return isObject(obj) || Array.isArray(obj);
}

class EventEmitter {
    private map = new Map<string, Function[]>();
    on(event: string, callback: (event: string, ...args: any[]) => void) {
        let callbacks = this.map.get(event);
        if (!callbacks) {
            callbacks = [];
            this.map.set(event, callbacks);
        }
        callbacks.push(callback);
    }
    off(event: string, callback: Function) {
        let callbacks = this.map.get(event);
        let index = callbacks?.indexOf(callback) ?? -1;
        if (index !== -1) {
            callbacks?.splice(index, 1);
        }
    }
    trigger(event: string, ...args: any[]) {
        let callbacks = [
            ...this.map.get(event) ?? [],
            ...this.map.get("*") ?? []
        ];

        for (let cb of callbacks) {
            cb(event, ...args);
        }
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
            event?.trigger("set", {
                event: "set",
                path: ["length"],
                value: newLength,
                oldValue: oldLength
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

            let needPrxoy = isProxyArrayMethods(obj, key);
            if (needPrxoy) {
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
                event?.trigger("set", {
                    event: "set",
                    path: [key],
                    value,
                    oldValue
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
                event?.trigger("delete", {
                    event: "delete",
                    path: [key],
                    value: undefined,
                    oldValue
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

    let pEvent = new EventEmitter();
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

export function watch(obj: object, event: string, callback: (event: string, data: EventData) => void) {
    if (!isObservable(obj)) throw new Error();

    let target = objectMap.get(obj);
    if (!target) throw new Error();

    let e = eventMap.get(target);
    e?.on(event, callback);
}

export function unwatch(obj: object, event: string, callback: Function) {
    if (!isObservable(obj)) throw new Error();

    let target = objectMap.get(obj);
    if (!target) throw new Error();

    let e = eventMap.get(target);
    e?.off(event, callback);
}