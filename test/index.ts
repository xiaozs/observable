import { observable, watch, unwatch, EventData } from "../src/index";

let obj: any = observable({
    l1: {
        l2: "test"
    }
});

function callback(event: string, data: EventData) {
    console.log(JSON.stringify(data));
}

watch(obj, "*", callback);

obj.test = {};
obj.test.test = "10";
obj.test.test = "10";
obj.test = {};

unwatch(obj, "*", callback);

obj.test = {};
obj.test.test = "15";
obj.test.test = "15";
obj.test = {};

watch(obj, "*", callback);
obj.arr = [];
obj.arr.push({ test: 2 });
obj.arr.push({ test: 1 });
obj.arr.sort((a: any, b: any) => a.test - b.test);
obj.arr.splice(0, 1);

obj.arr[0].test = "test";

obj.arr.length = 0;