import { observable, watch } from "../src/index";

let obj: any = observable({
    l1: {
        l2: "test"
    }
});

watch(obj, "*", function (event, data) {
    console.log(JSON.stringify(data));
})
obj.test = {};
obj.test.test = "10";
obj.test = {};