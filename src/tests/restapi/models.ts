/*eslint-env mocha */
import * as uuid from 'uuid/v1';
import * as fs from 'fs';
import * as assert from 'assert';
import * as request from 'supertest';
import * as httpstatus from 'http-status';
import * as sinon from 'sinon';
import * as randomstring from 'randomstring';
import * as express from 'express';

import * as store from '../../lib/db/store';
import * as auth from '../../lib/restapi/auth';
import * as conversation from '../../lib/training/conversation';
import * as visualrecog from '../../lib/training/visualrecognition';
import * as numbers from '../../lib/training/numbers';
import * as DbTypes from '../../lib/db/db-types';
import * as Types from '../../lib/training/training-types';
import testapiserver from './testserver';


let testServer: express.Express;


describe('REST API - models', () => {

    let authStub: sinon.SinonStub;

    let nextAuth0Userid = 'studentid';
    let nextAuth0Role = 'student';
    let nextAuth0Class = 'CLASSID';


    function authNoOp(
        req: Express.Request, res: Express.Response,
        next: (err?: Error) => void)
    {
        req.user = {
            sub : nextAuth0Userid,
            app_metadata : {
                role : nextAuth0Role,
                tenant : nextAuth0Class,
            },
        };
        next();
    }

    const conversationStub: { [label: string]: sinon.SinonStub } = {
        getClassifiersStub : sinon.stub(conversation, 'getClassifierStatuses'),
        trainClassifierStub : sinon.stub(conversation, 'trainClassifier'),
        testClassifierStub : sinon.stub(conversation, 'testClassifier'),
        deleteClassifierStub : sinon.stub(conversation, 'deleteClassifier'),
    };
    const numbersStub: { [label: string]: sinon.SinonStub } = {
        trainClassifierStub : sinon.stub(numbers, 'trainClassifier'),
        testClassifierStub : sinon.stub(numbers, 'testClassifier'),
        deleteClassifierStub : sinon.stub(numbers, 'deleteClassifier'),
    };
    const imagesStub: { [label: string]: sinon.SinonStub } = {
        getClassifiersStub : sinon.stub(visualrecog, 'getClassifierStatuses'),
        trainClassifierStub : sinon.stub(visualrecog, 'trainClassifier'),
        deleteClassifierStub : sinon.stub(visualrecog, 'deleteClassifier'),
        testClassifierUrlStub : sinon.stub(visualrecog, 'testClassifierURL'),
        testClassifierFileStub : sinon.stub(visualrecog, 'testClassifierFile'),
    };

    const updated = new Date();
    updated.setMilliseconds(0);


    before(async () => {
        authStub = sinon.stub(auth, 'authenticate').callsFake(authNoOp);

        conversationStub.getClassifiersStub.callsFake((classid, classifiers: Types.ConversationWorkspace[]) => {
            return new Promise((resolve) => {
                resolve(classifiers.map((classifier) => {
                    classifier.updated = updated;

                    switch (classifier.workspace_id) {
                    case 'good':
                        classifier.status = 'Available';
                        return classifier;
                    case 'busy':
                        classifier.status = 'Training';
                        return classifier;
                    }
                }));
            });
        });

        conversationStub.trainClassifierStub.callsFake((project: DbTypes.Project) => {
            if (project.name === 'no more room') {
                const err = new Error(conversation.ERROR_MESSAGES.INSUFFICIENT_API_KEYS);
                return Promise.reject(err);
            }
            else if (project.name === 'bad creds') {
                const err: any = new Error('Unauthorized');
                err.statusCode = httpstatus.UNAUTHORIZED;
                return Promise.reject(err);
            }
            else if (project.name === 'no creds') {
                const err: any = new Error('Unexpected response when retrieving service credentials');
                return Promise.reject(err);
            }
            else if (project.name === 'too fast') {
                const err: any = new Error(conversation.ERROR_MESSAGES.API_KEY_RATE_LIMIT);
                return Promise.reject(err);
            }
            else if (project.name === 'deleted model') {
                const err: any = new Error(conversation.ERROR_MESSAGES.MODEL_NOT_FOUND);
                return Promise.reject(err);
            }
            else {
                const workspace: Types.ConversationWorkspace = {
                    id : uuid(),
                    workspace_id : 'NEW-CREATED',
                    credentialsid : '123',
                    name : project.name,
                    language : 'en',
                    created : new Date(Date.UTC(2017, 4, 4, 12, 0)),
                    updated : new Date(Date.UTC(2017, 4, 4, 12, 1)),
                    expiry : new Date(Date.UTC(2017, 4, 4, 13, 0)),
                    url : 'http://conversation.service/api/classifiers/NEW-CREATED',
                    status : 'Training',
                };
                return Promise.resolve(workspace);
            }
        });
        conversationStub.testClassifierStub.callsFake(() => {
            const classifierTimestamp = new Date(Date.UTC(2017, 4, 4, 12, 1));
            const classifications: Types.Classification[] = [
                { class_name : 'first', confidence : 0.8, classifierTimestamp },
                { class_name : 'second', confidence : 0.15, classifierTimestamp },
                { class_name : 'third', confidence : 0.05, classifierTimestamp },
            ];
            return Promise.resolve(classifications);
        });
        conversationStub.deleteClassifierStub.callsFake(() => {
            return Promise.resolve();
        });

        numbersStub.trainClassifierStub.callsFake((project: DbTypes.Project) => {
            return Promise.resolve({
                created : new Date(),
                status : 'Available',
                classifierid : project.id,
            });
        });
        numbersStub.testClassifierStub.callsFake(() => {
            const classifierTimestamp = new Date();
            const classifications: Types.Classification[] = [
                { class_name : 'first', confidence : 0.8, classifierTimestamp },
                { class_name : 'second', confidence : 0.15, classifierTimestamp },
                { class_name : 'third', confidence : 0.05, classifierTimestamp },
            ];
            return Promise.resolve(classifications);
        });
        numbersStub.deleteClassifierStub.callsFake(() => {
            return new Promise((resolve) => { resolve(); });
        });

        imagesStub.getClassifiersStub.callsFake((classid, classifiers: Types.VisualClassifier[]) => {
            return new Promise((resolve) => {
                resolve(classifiers.map((classifier) => {
                    switch (classifier.classifierid) {
                    case 'good':
                        classifier.status = 'ready';
                        return classifier;
                    case 'busy':
                        classifier.status = 'training';
                        return classifier;
                    }
                }));
            });
        });

        imagesStub.trainClassifierStub.callsFake((project: DbTypes.Project) => {
            if (project.name === 'no more room') {
                const err = new Error(visualrecog.ERROR_MESSAGES.INSUFFICIENT_API_KEYS);
                return Promise.reject(err);
            }
            else if (project.name === 'insufficient') {
                const err = new Error('Not enough images to train the classifier');
                return Promise.reject(err);
            }
            else if (project.name === 'unknown creds') {
                const err: any = new Error('Unauthorized');
                err.statusCode = httpstatus.UNAUTHORIZED;
                return Promise.reject(err);
            }
            else if (project.name === 'bad creds') {
                const err: any = new Error('Unauthorized');
                err.statusCode = httpstatus.FORBIDDEN;
                return Promise.reject(err);
            }
            else if (project.name === 'no creds') {
                const err: any = new Error('Unexpected response when retrieving service credentials');
                return Promise.reject(err);
            }
            else if (project.name === 'too fast') {
                const err: any = new Error(visualrecog.ERROR_MESSAGES.API_KEY_RATE_LIMIT);
                return Promise.reject(err);
            }
            else {
                const workspace: Types.VisualClassifier = {
                    id : uuid(),
                    classifierid : 'NEW-CREATED',
                    credentialsid : '123',
                    name : project.name,
                    created : new Date(Date.UTC(2017, 4, 4, 12, 0)),
                    expiry : new Date(Date.UTC(2017, 4, 4, 13, 0)),
                    url : 'http://visualrecog.service/api/classifiers/NEW-CREATED',
                    status : 'training',
                };
                return Promise.resolve(workspace);
            }
        });
        imagesStub.deleteClassifierStub.callsFake(() => {
            return Promise.resolve();
        });
        imagesStub.testClassifierUrlStub.callsFake((
            creds: Types.BluemixCredentials, classifierid: string,
            classifierTimestamp: Date,
            // projectid: string, imageurl: string,
            ) =>
        {
            const classifications: Types.Classification[] = [
                { class_name : 'First', confidence : 0.6, classifierTimestamp },
                { class_name : 'Second', confidence : 0.2, classifierTimestamp },
            ];
            return Promise.resolve(classifications);
        });
        imagesStub.testClassifierFileStub.callsFake((
            creds: Types.BluemixCredentials, classifierid: string,
            classifierTimestamp: Date,
            projectid: string, imagefile: string) =>
        {
            return new Promise((resolve, reject) => {
                fs.access(imagefile, fs.constants.R_OK, (err) => {
                    if (err) {
                        return reject(err);
                    }

                    const classifications: Types.Classification[] = [
                        { class_name : 'Third', confidence : 0.5, classifierTimestamp },
                        { class_name : 'Fourth', confidence : 0.4, classifierTimestamp },
                    ];
                    return resolve(classifications);
                });
            });
        });


        await store.init();

        testServer = testapiserver();
    });


    after(() => {
        authStub.restore();

        conversationStub.getClassifiersStub.restore();
        conversationStub.trainClassifierStub.restore();
        conversationStub.testClassifierStub.restore();
        conversationStub.deleteClassifierStub.restore();
        numbersStub.trainClassifierStub.restore();
        numbersStub.testClassifierStub.restore();
        numbersStub.deleteClassifierStub.restore();
        imagesStub.getClassifiersStub.restore();
        imagesStub.trainClassifierStub.restore();
        imagesStub.deleteClassifierStub.restore();
        imagesStub.testClassifierUrlStub.restore();
        imagesStub.testClassifierFileStub.restore();

        return store.disconnect();
    });



    describe('getModels', () => {

        it('should verify project exists', () => {
            const classid = uuid();
            const studentid = uuid();
            const projectid = uuid();

            nextAuth0Userid = studentid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + studentid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then((res) => {
                    const body = res.body;
                    assert.strictEqual(body.error, 'Not found');
                });
        });

        it('should verify user id', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/DIFFERENTUSER/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.FORBIDDEN)
                .then(() => {
                    return store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle projects without classifiers', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then((res) => {
                    const body = res.body;
                    assert.deepStrictEqual(body, []);

                    return store.deleteEntireUser(userid, classid);
                });
        });



        it('should handle image projects without classifiers', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'images', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then((res) => {
                    const body = res.body;
                    assert.deepStrictEqual(body, []);

                    return store.deleteEntireUser(userid, classid);
                });
        });


        it('should retrieve images classifiers', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'images', 'demo', 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };

            const createdA = new Date();
            createdA.setMilliseconds(0);

            const classifierAInfo: Types.VisualClassifier = {
                id : uuid(),
                classifierid : 'good',
                credentialsid : credentials.id,
                created : createdA,
                expiry : createdA,
                name : 'DUMMY ONE',
                url : uuid(),
            };
            await store.storeImageClassifier(credentials, project, classifierAInfo);

            const createdB = new Date();
            createdB.setMilliseconds(0);

            const classifierBInfo: Types.VisualClassifier = {
                id : uuid(),
                classifierid : 'busy',
                credentialsid : credentials.id,
                created : createdB,
                expiry : createdB,
                name : 'DUMMY TWO',
                url : uuid(),
            };
            await store.storeImageClassifier(credentials, project, classifierBInfo);


            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {

                    assert.deepStrictEqual(res.body, [
                        {
                            classifierid : 'busy',
                            credentialsid : credentials.id,
                            updated : createdB.toISOString(),
                            expiry : createdB.toISOString(),
                            name : 'DUMMY TWO',
                            status : 'Training',
                        },
                        {
                            classifierid : 'good',
                            credentialsid : credentials.id,
                            updated : createdA.toISOString(),
                            expiry : createdA.toISOString(),
                            name : 'DUMMY ONE',
                            status : 'Available',
                        },
                    ]);

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should retrieve numbers classifiers', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'numbers', 'demo', 'en', [
                { name : 'a', type : 'number' }, { name : 'b', type : 'number' },
            ], false);
            const projectid = project.id;

            const classifier = await store.storeNumbersClassifier(userid, classid, projectid, 'Available');
            const created = classifier.created;
            created.setMilliseconds(0);

            const expectedTimestamp = created.toISOString();

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {
                    assert.strictEqual(res.body.length, 1);
                    assert.strictEqual(res.body[0].classifierid, projectid);
                    assert.strictEqual(res.body[0].status, 'Available');
                    assert(res.body[0].created);
                    assert(res.body[0].updated);
                    assert.strictEqual(res.body[0].created.substr(0, 18), expectedTimestamp.substr(0, 18));
                    assert.strictEqual(res.body[0].updated.substr(0, 18), expectedTimestamp.substr(0, 18));

                    await store.deleteEntireProject(userid, classid, project);
                });
        });


        it('should retrieve text classifiers', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };

            const createdA = new Date();
            createdA.setMilliseconds(0);

            const classifierAInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : 'good',
                credentialsid : credentials.id,
                created : createdA,
                expiry : createdA,
                language : 'en',
                name : 'DUMMY ONE',
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierAInfo);

            const createdB = new Date();
            createdB.setMilliseconds(0);

            const classifierBInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : 'busy',
                credentialsid : credentials.id,
                created : createdB,
                expiry : createdB,
                language : 'en',
                name : 'DUMMY TWO',
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierBInfo);


            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .get('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {

                    assert.deepStrictEqual(res.body, [
                        {
                            classifierid : 'busy',
                            credentialsid : credentials.id,
                            updated : updated.toISOString(),
                            expiry : createdB.toISOString(),
                            name : 'DUMMY TWO',
                            status : 'Training',
                        },
                        {
                            classifierid : 'good',
                            credentialsid : credentials.id,
                            updated : updated.toISOString(),
                            expiry : createdA.toISOString(),
                            name : 'DUMMY ONE',
                            status : 'Available',
                        },
                    ]);

                    await store.deleteEntireUser(userid, classid);
                });
        });

    });

    describe('newModel', () => {

        it('should verify project exists', () => {
            const classid = uuid();
            const studentid = uuid();
            const projectid = uuid();
            nextAuth0Userid = studentid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + studentid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then((res) => {
                    const body = res.body;
                    assert.strictEqual(body.error, 'Not found');
                });
        });

        it('should verify user id', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = 'DIFFERENTUSER';
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/DIFFERENTUSER/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.FORBIDDEN)
                .then(() => {
                    return store.deleteEntireUser(userid, classid);
                });
        });

        it('should verify user', async () => {
            const classid = uuid();
            const userid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = 'SOMEUSER';
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.FORBIDDEN)
                .then(() => {
                    return store.deleteEntireUser(userid, classid);
                });
        });

        it('should enforce tenant policies on number of Conversation classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'no more room';

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error, conversation.ERROR_MESSAGES.INSUFFICIENT_API_KEYS);

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle bad text credentials in unmanaged classes', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'bad creds';

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'The Watson credentials being used by your class were rejected. ' +
                        'Please let your teacher or group leader know.');

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle missing text credentials in unmanaged classes', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'no creds';

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'No Watson credentials have been set up for training text projects. ' +
                        'Please let your teacher or group leader know.');

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle failure when updating deleted Conversation workspaces', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'deleted model';

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'Your machine learning model could not be found on the training server. Please try again');

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle rate limit errors from Conversation', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'too fast';

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.TOO_MANY_REQUESTS)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'Your class is making too many requests to create machine learning models ' +
                         'at too fast a rate. ' +
                         'Please stop now and let your teacher or group leader know that ' +
                         '"the Watson Assistant service is currently rate limiting their API key"');

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should train new text classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CREATED)
                .then((res) => {
                    const body = res.body;

                    assert.deepStrictEqual(body, {
                        updated : '2017-05-04T12:01:00.000Z',
                        expiry : '2017-05-04T13:00:00.000Z',
                        name : projName,
                        status : 'Training',
                        classifierid : 'NEW-CREATED',
                        credentialsid : '123',
                    });

                    return store.deleteEntireUser(userid, classid);
                });
        });


        it('should enforce tenant policies on number of image classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'no more room';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error, visualrecog.ERROR_MESSAGES.INSUFFICIENT_API_KEYS);

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle rate limiting from Visual Recognition API', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'too fast';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.TOO_MANY_REQUESTS)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'Your class is making too many requests to create machine learning models ' +
                         'at too fast a rate. ' +
                         'Please stop now and let your teacher or group leader know that ' +
                         '"the Watson Visual Recognition service is currently rate limiting their API key"');

                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should handle bad images credentials in unmanaged classes', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'unknown creds';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'The Watson credentials being used by your class were rejected. ' +
                        'Please let your teacher or group leader know.');

                    await store.deleteEntireUser(userid, classid);
                });
        });

        it('should handle bad images credentials in unmanaged classes', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'bad creds';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'The Watson credentials being used by your class were rejected. ' +
                        'Please let your teacher or group leader know.');

                    await store.deleteEntireUser(userid, classid);
                });
        });

        it('should handle missing images credentials in unmanaged classes', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'no creds';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CONFLICT)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'No Watson credentials have been set up for training images projects. ' +
                        'Please let your teacher or group leader know.');

                    await store.deleteEntireUser(userid, classid);
                });
        });

        it('should handle requests to train projects without enough training data', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = 'insufficient';

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then(async (res) => {
                    const body = res.body;

                    assert.strictEqual(body.error,
                        'Not enough images to train the classifier');

                    await store.deleteEntireUser(userid, classid);
                });
        });

        it('should train new image classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CREATED)
                .then((res) => {
                    const body = res.body;

                    assert.deepStrictEqual(body, {
                        updated : '2017-05-04T12:00:00.000Z',
                        expiry : '2017-05-04T13:00:00.000Z',
                        name : projName,
                        status : 'Training',
                        classifierid : 'NEW-CREATED',
                        credentialsid : '123',
                    });

                    return store.deleteEntireUser(userid, classid);
                });
        });


        it('should train new numbers classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();

            const project = await store.storeProject(userid, classid, 'numbers', projName, 'en', [
                { name : 'a', type : 'number' }, { name : 'b', type : 'number' },
            ], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid + '/students/' + userid + '/projects/' + projectid + '/models')
                .expect('Content-Type', /json/)
                .expect(httpstatus.CREATED)
                .then((res) => {
                    const body = res.body;

                    assert.strictEqual(body.status, 'Available');
                    assert.strictEqual(body.classifierid, projectid);

                    const created = new Date(body.created);
                    assert.strictEqual(isNaN(created.getDate()), false);

                    return store.deleteEntireProject(userid, classid, project);
                });
        });
    });


    describe('testModel', () => {

        it('should require a model type', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    text : 'my test text',
                    credentialsid : 'HELLO',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Missing data' });
                });
        });


        it('should require text to test with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'text',
                    credentialsid : 'HELLO',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Missing data' });
                });
        });

        it('should require images to test with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'images',
                    credentialsid : 'HELLO',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Missing data' });
                });
        });




        it('should require credentials to test with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'text',
                    text : 'HELLO',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Missing data' });
                });
        });


        it('should require valid credentials to test text with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'text',
                    text : 'HELLO',
                    credentialsid : 'blahblahblah',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Not found' });
                });
        });


        it('should require credentials to test images with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'images',
                    text : 'HELLO',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Missing data' });
                });
        });


        it('should require valid credentials to test images with', () => {
            nextAuth0Userid = 'userid';
            nextAuth0Role = 'student';
            nextAuth0Class = 'classid';
            return request(testServer)
                .post('/api/classes/' + 'classid' +
                        '/students/' + 'userid' +
                        '/projects/' + 'projectid' +
                        '/models/' + 'modelid' +
                        '/label')
                .send({
                    type : 'images',
                    text : 'HELLO',
                    credentialsid : 'blahblahblah',
                    image : 'http://www.lovelypictures.com/cat.jpg',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then((resp) => {
                    assert.deepStrictEqual(resp.body, { error : 'Not found' });
                });
        });


        it('should submit a classify request to Conversation', async () => {

            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                language : 'en',
                name : projName,
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierInfo);

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid +
                        '/label')
                .send({
                    text : 'my test text',
                    type : 'text',
                    credentialsid : credentials.id,
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {
                    const body = res.body;

                    const classifierTimestamp = body[0].classifierTimestamp;
                    assert(classifierTimestamp);

                    assert.deepStrictEqual(body, [
                        { class_name : 'first', confidence : 0.8, classifierTimestamp },
                        { class_name : 'second', confidence : 0.15, classifierTimestamp },
                        { class_name : 'third', confidence : 0.05, classifierTimestamp },
                    ]);

                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);
                });
        });

        it('should submit a classify request to numbers service', () => {
            nextAuth0Role = 'testuser';
            nextAuth0Class = 'testclass';
            return request(testServer)
                .post('/api/classes/testclass/students/testuser/projects/testproject/models/testmodel/label')
                .send({
                    numbers : [1, 2, 3],
                    type : 'numbers',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then((res) => {
                    const body = res.body;

                    const classifierTimestamp = body[0].classifierTimestamp;
                    assert(classifierTimestamp);

                    assert.deepStrictEqual(body, [
                        { class_name : 'first', confidence : 0.8, classifierTimestamp },
                        { class_name : 'second', confidence : 0.15, classifierTimestamp },
                        { class_name : 'third', confidence : 0.05, classifierTimestamp },
                    ]);
                });
        });


        it('should submit a URL classify request to Visual Recognition', async () => {

            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : randomstring.generate(20),
                password : randomstring.generate(20),
                servicetype : 'visrec',
                url : 'https://gateway-a.watsonplatform.net/visual-recognition/api',
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierTimestamp = created.toISOString();

            const classifierInfo: Types.VisualClassifier = {
                id : uuid(),
                classifierid : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                name : projName,
                url : uuid(),
            };
            await store.storeImageClassifier(credentials, project, classifierInfo);

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid +
                        '/label')
                .send({
                    image : 'http://www.lovelypictures.com/cat.jpg',
                    type : 'images',
                    credentialsid : credentials.id,
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {
                    const body = res.body;

                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);

                    assert.notStrictEqual(classifierTimestamp, body[0].classifierTimestamp);
                    assert.notStrictEqual(classifierTimestamp, body[1].classifierTimestamp);

                    delete body[0].classifierTimestamp;
                    delete body[1].classifierTimestamp;

                    assert.deepStrictEqual(body, [
                        { class_name : 'First', confidence : 0.6 },
                        { class_name : 'Second', confidence : 0.2 },
                    ]);
                });
        });



        it('should submit a file classify request to Visual Recognition', async () => {

            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : randomstring.generate(20),
                password : randomstring.generate(20),
                servicetype : 'visrec',
                url : 'https://gateway-a.watsonplatform.net/visual-recognition/api',
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierTimestamp = created.toISOString();

            const classifierInfo: Types.VisualClassifier = {
                id : uuid(),
                classifierid : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                name : projName,
                url : uuid(),
            };
            await store.storeImageClassifier(credentials, project, classifierInfo);

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .post('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid +
                        '/label')
                .send({
                    data : 'PRETEND THIS IS THE DATA OF AN IMAGE',
                    type : 'images',
                    credentialsid : credentials.id,
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.OK)
                .then(async (res) => {
                    const body = res.body;

                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);

                    assert.notStrictEqual(classifierTimestamp, body[0].classifierTimestamp);
                    assert.notStrictEqual(classifierTimestamp, body[1].classifierTimestamp);

                    delete body[0].classifierTimestamp;
                    delete body[1].classifierTimestamp;

                    assert.deepStrictEqual(body, [
                        { class_name : 'Third', confidence : 0.5 },
                        { class_name : 'Fourth', confidence : 0.4 },
                    ]);
                });
        });


        it('should require data for the numbers service', () => {
            nextAuth0Role = 'testuser';
            nextAuth0Class = 'testclass';
            return request(testServer)
                .post('/api/classes/testclass/students/testuser/projects/testproject/models/testmodel/label')
                .send({
                    type : 'numbers',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST);
        });

        it('should require numbers for the numbers service', () => {
            nextAuth0Role = 'testuser';
            nextAuth0Class = 'testclass';
            return request(testServer)
                .post('/api/classes/testclass/students/testuser/projects/testproject/models/testmodel/label')
                .send({
                    numbers : [],
                    type : 'numbers',
                })
                .expect('Content-Type', /json/)
                .expect(httpstatus.BAD_REQUEST);
        });

    });

    describe('deleteModel', () => {

        it('should verify project exists', () => {
            const classid = uuid();
            const studentid = uuid();
            const projectid = uuid();
            const modelid = uuid();
            nextAuth0Userid = studentid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/' + studentid +
                        '/projects/' + projectid +
                        '/models/' + modelid)
                .expect('Content-Type', /json/)
                .expect(httpstatus.NOT_FOUND)
                .then((res) => {
                    const body = res.body;
                    assert.strictEqual(body.error, 'Not found');
                });
        });

        it('should verify user id', async () => {
            const classid = uuid();
            const userid = uuid();
            const modelid = uuid();

            const project = await store.storeProject(userid, classid, 'text', 'demo', 'en', [], false);
            const projectid = project.id;

            nextAuth0Userid = 'DIFFERENTUSER';
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/DIFFERENTUSER/projects/' + projectid +
                        '/models/' + modelid)
                .expect('Content-Type', /json/)
                .expect(httpstatus.FORBIDDEN)
                .then(() => {
                    return store.deleteEntireUser(userid, classid);
                });
        });

        it('should allow teachers to delete models', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                language : 'en',
                name : projName,
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierInfo);

            nextAuth0Userid = 'teacheruserid';
            nextAuth0Role = 'supervisor';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid)
                .expect(httpstatus.NO_CONTENT)
                .then(async () => {
                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);
                });
        });


        it('should not allow teachers from other classes to delete models', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                language : 'en',
                name : projName,
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierInfo);

            nextAuth0Userid = 'teacheruserid';
            nextAuth0Role = 'supervisor';
            nextAuth0Class = 'DIFFERENTCLASSID';
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/teacheruserid/projects/' + projectid +
                        '/models/' + modelid)
                .expect(httpstatus.FORBIDDEN)
                .expect('Content-Type', /json/)
                .then(() => {
                    return store.deleteEntireUser(userid, classid);
                });
        });


        it('should delete numbers classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'numbers', projName, 'en', [
                { name : 'A', type : 'number' },
            ], false);
            const projectid = project.id;

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid)
                .expect(httpstatus.NO_CONTENT)
                .then(async () => {
                    await store.deleteEntireUser(userid, classid);
                });
        });


        it('should delete text classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'text', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierInfo: Types.ConversationWorkspace = {
                id : uuid(),
                workspace_id : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                language : 'en',
                name : projName,
                url : uuid(),
            };
            await store.storeConversationWorkspace(credentials, project, classifierInfo);

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid)
                .expect(httpstatus.NO_CONTENT)
                .then(async () => {
                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);
                });
        });


        it('should delete image classifiers', async () => {
            const classid = uuid();
            const userid = uuid();
            const projName = uuid();
            const modelid = randomstring.generate({ length : 10 });

            const project = await store.storeProject(userid, classid, 'images', projName, 'en', [], false);
            const projectid = project.id;

            const credentials: Types.BluemixCredentials = {
                id : uuid(),
                username : uuid(),
                password : uuid(),
                servicetype : 'conv',
                url : uuid(),
                classid,
            };
            await store.storeBluemixCredentials(classid, credentials);

            const created = new Date();
            created.setMilliseconds(0);

            const classifierInfo: Types.VisualClassifier = {
                id : uuid(),
                classifierid : modelid,
                credentialsid : credentials.id,
                created,
                expiry : created,
                name : projName,
                url : uuid(),
            };
            await store.storeImageClassifier(credentials, project, classifierInfo);

            nextAuth0Userid = userid;
            nextAuth0Role = 'student';
            nextAuth0Class = classid;
            return request(testServer)
                .delete('/api/classes/' + classid +
                        '/students/' + userid +
                        '/projects/' + projectid +
                        '/models/' + modelid)
                .expect(httpstatus.NO_CONTENT)
                .then(async () => {
                    await store.deleteEntireUser(userid, classid);
                    await store.deleteBluemixCredentials(credentials.id);
                });
        });

    });
});
