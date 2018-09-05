import { ReactTestRenderer } from "react-test-renderer";
import timekeeper from "timekeeper";
import uuid from "uuid/v4";

import { timeout } from "talk-common/utils";
import { createSinonStub } from "talk-framework/testHelpers";
import { UUIDMock } from "talk-test/mocks";

import create from "./create";
import { assets, users } from "./fixtures";

const uuidMock = uuid as UUIDMock;

let testRenderer: ReactTestRenderer;
beforeEach(() => {
  const resolvers = {
    Query: {
      asset: createSinonStub(
        s => s.throws(),
        s => s.withArgs(undefined, { id: assets[0].id }).returns(assets[0])
      ),
      me: createSinonStub(
        s => s.throws(),
        s => s.withArgs(undefined, { clientAuthRevision: 0 }).returns(users[0])
      ),
    },
    Mutation: {
      createComment: createSinonStub(
        s => s.throws(),
        s =>
          s
            .withArgs(undefined, {
              input: {
                assetID: assets[0].id,
                body: "<strong>Hello world!</strong>",
                clientMutationId: "0",
              },
            })
            .returns({
              // TODO: add a type assertion here to ensure that if the type changes, that the test will fail
              edge: {
                cursor: "2018-07-06T18:24:00.000Z",
                node: {
                  id: "comment-x",
                  author: users[0],
                  body: "<strong>Hello world! (from server)</strong>",
                  createdAt: "2018-07-06T18:24:00.000Z",
                },
              },
              clientMutationId: "0",
            })
      ),
    },
  };

  ({ testRenderer } = create({
    // Set this to true, to see graphql responses.
    logNetwork: false,
    resolvers,
    initLocalState: localRecord => {
      localRecord.setValue(assets[0].id, "assetID");
    },
  }));
});

it("renders comment stream", async () => {
  // Wait for loading.
  await timeout();
  expect(testRenderer.toJSON()).toMatchSnapshot();
});

it("post a comment", async () => {
  // set next UUID of the optimistic response.
  uuidMock.setMockData(["comment-optimistic"]);

  // Wait for loading.
  await timeout();
  testRenderer.root
    .findByProps({ inputId: "comments-postCommentForm-field" })
    .props.onChange({ html: "<strong>Hello world!</strong>" });

  timekeeper.freeze(new Date("2018-07-06T18:24:00.000Z"));

  testRenderer.root
    .findByProps({ id: "comments-postCommentForm-form" })
    .props.onSubmit();

  timekeeper.reset();

  // Test optimistic response.
  expect(testRenderer.toJSON()).toMatchSnapshot();

  // Wait for loading.
  await timeout();

  // Test after server response.
  expect(testRenderer.toJSON()).toMatchSnapshot();
});