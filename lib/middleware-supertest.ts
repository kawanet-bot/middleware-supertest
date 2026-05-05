// middleware-supertest.ts

import type {IncomingMessage, ServerResponse} from "node:http";
import type {Request, RequestHandler, Response} from "express";
import {responseHandler} from "express-intercept";
import supertest from "supertest";
import type * as types from "../types/middleware-supertest.d.ts";

export const mwsupertest: typeof types.mwsupertest = app => new MWSuperTest(app);

/**
 * Test an Express.js `RequestHandler` middleware on both the server side
 * and the client side in a single chain.
 */

class MWSuperTest implements types.MWSuperTest {
    private _agent: supertest.Agent;
    private chain: RequestHandler[] = [];
    private readonly app: RequestHandler;

    constructor(app: RequestHandler) {
        this.app = app;
    }

    private agent() {
        if (this._agent) return this._agent;

        // Compose the observation chain and the consumer-supplied app into a
        // single RequestHandler that supertest can hand to http.createServer.
        // We deliberately avoid calling `express()` or `express.Router()` here
        // so that the runtime contract is just "any callable RequestHandler",
        // which Express 4, Express 5, fastify-express, or a hand-written
        // handler all satisfy. The version of Express used by the consumer
        // never enters this module.
        const stack: RequestHandler[] = [...this.chain, this.app];
        // supertest expects a 2-arg RequestListener (`(req, res) => void`),
        // which is what `http.createServer` will hand us anyway. Internally
        // we treat the same `req` / `res` as Express objects because the
        // consumer's app — running as the last entry of the stack — is the
        // one that decorates them with the Express prototype.
        const composed = (req: IncomingMessage, res: ServerResponse) => {
            runChain(stack, req as Request, res as Response, (err?: any) => {
                // Fallback when neither the chain nor the app produced a
                // response. This mirrors the minimal behaviour of the
                // `finalhandler` package that Express attaches when you call
                // `app.listen()` (404 for unhandled, 500 for surfaced errors).
                if (res.headersSent) return;
                if (err) {
                    res.statusCode = (err && err.status) || 500;
                    res.end((err && err.message) || "Internal Server Error");
                } else {
                    res.statusCode = 404;
                    res.end("Not Found");
                }
            });
        };

        return (this._agent = supertest(composed));
    }

    use(mw: RequestHandler): this {
        this.chain.push(mw);
        this._agent = null;
        return this;
    }

    /**
     * defines a test function to test the response body as a `string` on server-side.
     */

    getString(checker: (str: string) => (any | Promise<any>)): this {
        return this.use(responseHandler().getString((str, req, res) => {
            return Promise.resolve(str).then(checker).catch(err => catchError(err, req, res));
        }));
    }

    /**
     * defines a test function to test the response body as a `Buffer` on server-side.
     */

    getBuffer(checker: (buf: Buffer) => (any | Promise<any>)): this {
        return this.use(responseHandler().getBuffer((buf, req, res) => {
            return Promise.resolve(buf).then(checker).catch(err => catchError(err, req, res));
        }));
    }

    /**
     * defines a test function to test the response object aka `res` on server-side.
     */

    getRequest(checker: (req: Request) => (any | Promise<any>)): this {
        return this.use(responseHandler().getBuffer((buf, req, res) => {
            return Promise.resolve().then(() => checker(req)).catch(err => catchError(err, req, res));
        }));
    }

    /**
     * defines a test function to test the request object aka `req` on server-side.
     */

    getResponse(checker: (res: Response) => (any | Promise<any>)): this {
        return this.use(responseHandler().getBuffer((buf, req, res) => {
            return Promise.resolve().then(() => checker(res)).catch(err => catchError(err, req, res));
        }));
    }

    /**
     * perform a HTTP `DELETE` request and returns a SuperTest object to continue tests on client-side.
     */

    delete(url: string) {
        return wrapRequest(this.agent().delete.apply(this.agent, arguments));
    }

    /**
     * perform a HTTP `GET` request and returns a SuperTest object to continue tests on client-side.
     */

    get(url: string) {
        return wrapRequest(this.agent().get.apply(this.agent, arguments));
    }

    /**
     * perform a HTTP `HEAD` request and returns a SuperTest object to continue tests on client-side.
     */

    head(url: string) {
        return wrapRequest(this.agent().head.apply(this.agent, arguments));
    }

    /**
     * perform a HTTP `POST` request and returns a SuperTest object to continue tests on client-side.
     */

    post(url: string) {
        return wrapRequest(this.agent().post.apply(this.agent, arguments));
    }

    /**
     * perform a HTTP `PUT` request and returns a SuperTest object to continue tests on client-side.
     */

    put(url: string) {
        return wrapRequest(this.agent().put.apply(this.agent, arguments));
    }
}

/**
 * @private
 *
 * Connect-style middleware runner. Iterates `handlers` in order, advancing
 * to the next one each time a handler invokes the supplied `next` callback.
 * Stops on the first error or when the list is exhausted, then calls `done`.
 *
 * This re-implements the slice of `express.Router()` semantics that mws
 * actually relies on (sequential `.use()` chaining, no path-prefix matching,
 * no 4-arg error handlers, no nested routers). Anything richer than that is
 * the consumer's own app, which we run as the last entry of the stack.
 */

function runChain(handlers: RequestHandler[], req: Request, res: Response, done: (err?: any) => void): void {
    let i = 0;
    const step = (err?: any) => {
        if (err) return done(err);
        if (i >= handlers.length) return done();
        handlers[i++](req, res, step);
    };
    step();
}

/**
 * @private
 */

function wrapRequest(req: supertest.Request): supertest.Test {
    const _req = req as unknown as { assert: (resError: any, res: any, fn: any) => void };
    const _assert = _req.assert;
    _req.assert = function (resError, res, fn) {
        let err: string = res?.header["x-mwsupertest"];
        if (err) {
            err = Buffer.from(err, "base64").toString();
            resError = new Error(err);
            res = null;
        }
        if (_assert) {
            return _assert.call(this, resError, res, fn);
        }
    };
    return req as supertest.Test;
}

/**
 * @private
 */

function catchError(err: string | Error, req: Request, res: Response) {
    if (!err) err = "error";

    if ("string" !== typeof err) {
        err = err.stack || err.message || err + "";
    }

    err = Buffer.from(err).toString("base64");
    res.setHeader("x-mwsupertest", err);
}
