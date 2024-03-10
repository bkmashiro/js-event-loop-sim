/**
 * JS Event Loop simulation
 */
const macro_task_queue = new Array<() => void>();
const micro_task_queue = new Array<() => void>();

function queueMicroTask(task: () => void) {
  log('queueMicroTask', getName(task));
  micro_task_queue.push(task);
}

function queueMacroTask(task: () => void) {
  log('queueMacroTask', getName(task));
  macro_task_queue.push(task);
}

class MyPromise<T> {
  name: string = 'unnamed';
  private state: 'pending' | 'resolved' | 'rejected' = 'pending';
  private result: T | undefined;
  private handlers: {
    onFullfilled: (result: T) => void;
    onRejected?: (err: any) => void;
    resolve: (result: T) => void;
    reject: (err: any) => void;
  }[] = [];

  constructor(callback: (resolve: (result?: T) => void, reject: (err?: any) => void) => void, cfg: { name?: string } = {}) {
    this.name = cfg.name || this.name;
    callback(
      (result?: T) => {
        queueMicroTask(named(`${getName(callback)}.resolve`, () => {
          this.changeState('resolved', result);
        }));
      },
      (err?: any) => {
        queueMicroTask(named(`${getName(callback)}.reject`, () => {
          this.changeState('rejected', err);
        }));
      }
    );
  }

  then(onFullfilled: (result?: T) => void, onRejected?: (err?: any) => void) {
    return new MyPromise(
      named(`${this.name}.then`,
        (resolve, reject) => {
          this.handlers.push({
            onFullfilled,
            onRejected,
            resolve: named(`${this.name}.then.resolve`, resolve),
            reject: named(`${this.name}.then.reject`, reject),
          });
          this.run();
        }
      ),
      { name: `${this.name}.then` }
    )
  }

  private _run(cb: any, resolve: (result?: any) => void, reject: (err?: any) => void) {
    if (typeof cb !== 'function') {
      const settled = this.state === 'resolved' ? resolve : reject;
      settled?.(this.result!);
      return;
    }
    try {
      const result = cb(this.result!);
      if (result instanceof MyPromise) {
        result.then(resolve, reject);
      } else {
        resolve(result);
      }
    } catch (err) {
      reject?.(err);
    }
  }

  private run() {
    if (this.state === 'pending') {
      return;
    }
    while (this.handlers.length > 0) {
      const { onFullfilled, onRejected, resolve, reject } = this.handlers.shift()!;
      if (this.state === 'resolved') {
        this._run(onFullfilled, resolve, reject);
      } else {
        this._run(onRejected, resolve, reject);
      }
    }
  }

  private changeState(state: "pending" | "resolved" | "rejected", result: T | undefined) {
    if (this.state !== 'pending') {
      return;
    }
    this.state = state;
    this.result = result;
    this.run();
  }
}

let _waiting_promises: number = 0;
async function tracked(p: MyPromise<any>) {
  _waiting_promises++;
  const res = await p;
  _waiting_promises--;
  return res;
}
function MySetTimeout(callback: () => void, delay: number) {
  WebApi.setTimeout(callback, delay);
}

class WebApi {
  static _timeout_id = 0;
  static timeouts: {
    _id: number;
    t: number;
    callback: () => void;
  }[] = []

  static setTimeout(callback: () => void, delay: number) {
    this.timeouts.push({
      _id: this._timeout_id++,
      t: delay,
      callback,
    });
  }

  static isIdle() {
    return WebApi.timeouts.length === 0;
  }
}

const sim_time_resolution = 100; //ms

function pseudoEventLoopThread() {
  let waited_time = 0;
  const eventLoop = setInterval(() => {
    if (macro_task_queue.length > 0) {
      const task = macro_task_queue.shift()!;
      task();
      // process micro tasks
      while (micro_task_queue.length > 0) {
        const task = micro_task_queue.shift()!;
        task();
      }
      waited_time = 0;
    } else {
      // no more ongoing tasks, but possibly there are pending WebApi calls
      if (
        // WebApi is idle
        WebApi.isIdle() &&
        macro_task_queue.length === 0 &&
        micro_task_queue.length === 0 &&
        _waiting_promises === 0 // no more waiting promises
      ) {
        // sure that there are no more tasks
        log('Event loop terminated');
        clearInterval(eventLoop);
      } else {
        // cannot terminate yet, wait for next iteration
        waited_time += sim_time_resolution;
        process.stdout.write('\r');
        process.stdout.write(`EventLoop: Idle for ${waited_time / 1000} seconds (promise: ${_waiting_promises}, api: ${WebApi.timeouts.length})`);
      }
    }
    // update time
    WebApi.timeouts.forEach((timeout) => {
      timeout.t -= sim_time_resolution;
      if (timeout.t <= 0) {
        queueMacroTask(timeout.callback);
        // remove timeout
        WebApi.timeouts = WebApi.timeouts.filter((t) => t._id !== timeout._id);
      }
    });
  }, sim_time_resolution);
}

function log(...args: any[]) {
  console.log(...args);
}

const nameSymbol = Symbol('name');
function named(name: string, cb: (...args: any) => any) {
  // @ts-ignore
  cb[nameSymbol] = name;
  return cb;
}

function getName(cb: (...args: any) => any) {
  // @ts-ignore
  return cb[nameSymbol] || cb.name || 'unnamed';
}

function main() {
  var a: any;
  var b = new MyPromise(named('b',
    (resolve, reject) => {
      log('promise1');
      MySetTimeout(
        named('timeout',
          () => {
            resolve();
          }
        ), 1000
      );
    }), { name: 'b' }).then(() => {
      log('promise2');
    }).then(() => {
      log('promise3');
    }).then(() => {
      log('promise4');
    });
  a = new MyPromise(async (resolve, reject) => {
    log(a)
    await tracked(b);
    log(a);
    log('after 1');
    await tracked(a);
    resolve(true);
    log('after 2');
  }, { name: 'a' })



  log('end');
}

queueMacroTask(main);

pseudoEventLoopThread();

