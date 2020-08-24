type proxyObject = object;
type pEventEmitter = EventEmitter;

let proxyMap = new WeakMap<object, proxyObject>();
let eventMap = new WeakMap<object, EventEmitter>();
let objectMap = new WeakMap<proxyObject, object>();
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

interface EventData {
    event: string;
    path: string[];
    value: any;
    oldValue: any;
}

function isObject(obj: any): obj is object {
    return Object.prototype.toString.call(obj) === "[object Object]";
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

export function observable<T extends object>(obj: T): T {
    if (!isObject(obj)) throw new Error();

    let res = proxyMap.get(obj);
    if (res) return res as T;

    let proxy = new Proxy(obj, {
        enumerate(obj) {
            let res = Reflect.enumerate(obj);
            return Array.from(res);
        },
        has(obj, key) {
            let res = Reflect.has(obj, key);
            return res;
        },
        get(obj, key) {
            let res = Reflect.get(obj, key);
            if (isObject(res)) {
                res = proxyMap.get(res);
            }
            return res;
        },
        set(obj: any, key, value) {
            let oldValue = obj[key];
            if (isObject(value)) {
                let object = objectMap.get(value);
                if (object) value = object;
            }

            let res = Reflect.set(obj, key, value);
            if (res) {
                if (isObject(oldValue)) {
                    unpipe(obj, oldValue, key);
                }

                if (isObject(value)) {
                    observable(value);
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
                if (isObject(oldValue)) {
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
    proxyMap.set(obj, proxy);
    objectMap.set(proxy, obj);

    let pEvent = new EventEmitter();
    eventMap.set(obj, pEvent);
    for (let key in obj) {
        let value = obj[key];
        if (isObject(value)) {
            observable(value);
            pipe(obj, value, key);
        }
    }

    return proxy;
}

export function watch(obj: object, event: string, callback: (event: string, data: EventData) => void) {
    if (!isObject(obj)) throw new Error();

    let target = objectMap.get(obj);
    if (!target) throw new Error();

    let e = eventMap.get(target);
    e?.on(event, callback);
}