# Talk Plugins

Plugins for Talk can take various forms, currently we are only supporting server
side plugins.

## Plugin Registration: `plugins.json`

All plugins must be registered in the root file `plugins.json`.

The format for this file is thus:

```json
{
  "server": [
    "people"
  ]
}
```

Where we have a `server` key with an array of plugins that match the folder
name in the `plugins/` folder. For example, the above `plugins.json` would
require a plugin from `plugins/people`, which must provide a `index.js` file
that returns an object that matches the Plugin Specification.

If the package is external (available on NPM) you can specify the string for
the version by using an object instead, for example:

```json
{
  "server": [
    {"people": "^1.2.0"}
  ]
}
```

External plugins can be resolved by running:

```bash
./bin/cli plugins reconcile
```

This will also traverse into local plugin folders and install their
dependancies. _Note that if the plugin is already installed and available in the
node_modules folder, it will not be fetched again unless there is a version
mismatch._

## Plugin Dependencies

From your plugins you may import any component of server code relative to the
project root. An example could be:

```js
const cache = require('services/cache');
```

You may also include additional external depenancies in your local packages by
specifying a `package.json` at your plugin root which will result in a
`node_modules` folder being generated at the plugin root with your specific
dependencies.

## Server Plugins

### Specification

Each plugin should export a single object with all hooks available on it.

_**Note: You will have access to the whole core and other plugin's typeDefs,
context, loaders, mutators, resolvers, hooks. This is intentional, as it
encourages composing plugins to merge functionality, like a Slack plugin which
provides a Slack notify context function as well as having the loader for
comments.**_

The following are the hooks available:

#### Field: `typeDefs`

```graphql
enum COLOUR {
  RED
  BLUE
}

type Person {
  name: String!
  colour: COLOUR!
}

type RootMutation {
  createPerson(name: String!): Person
}

type RootQuery {
  people: [Person!]
}
```

Thanks to [gql-merge](https://www.npmjs.com/package/gql-merge) the contents of
`typeDefs` should be a string that will be _merged_ with the existing type
definitions. `enum`'s will be appended to, types will be appended, and new types
will be added.

#### Field: `context`

```js
{
  Slack: (context) => ({
    notify: (message) => {
      // return a promise after we're done sending notifications.
    }
  })
}
```

Any property provided here will be added to the context parameter available
inside all resolvers, loaders, mutators, and of course, other context based
plugins.

The top level item must accept a context for the request which it should use to
configure the context plugin before it would be mounted at `context.plugins`.
This plugin above would mount at: `context.plugins.Slack`, or, if you're using
[object destructuring](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment), `{plugins: {Slack}}`.

#### Field: `loaders`

```js
(context) => ({
  People: {
    load: () => db.people.find({user: context.user})
  }
})
```

Loaders should be provided as a function which returns a map which is used in
the resolvers function. These must return a promise or a value.

#### Field: `mutators`

```js
(context) => ({
  People: {
    create: (name) => {
      return db.people.insert({user: context.user, name});
    }
  }
})
```

Mutators should be provided as a function which returns a map which is used in
the resolvers function. These must return a promise or a value.

#### Field: `resolvers`

```js
{
  Person: {
    name(obj, args, context) {
      return obj.name;
    },
    colour(obj, args, context) {
      // Bill likes the colour red, everyone else likes blue.
      return obj.name === 'bill' ? 'RED' : 'BLUE';
    }
  },
  RootQuery: {
    people(obj, args, {loaders: {People}}) {
      return People.load();
    }
  },
  RootMutation: {
    createPerson(obj, {name}, {mutators: {People}}) {
      return People.create(name);
    }
  }
}
```

Should return a resolver map as described in the
[Apollo Docs](http://dev.apollodata.com/tools/graphql-tools/resolvers.html#Resolver-map).

This will merge with the existing resolvers in core and from previous plugins.

#### Field: `hooks`

```js
{
  RootMutation: {
    createPerson: {
      post: async (obj, args, {plugins: {Slack}}, info, person) {
        if (!person) {
          return person;
        }

        await Slack.notify(`A new person just was created with name ${person.name}`);

        return person;
      }
    }
  }
}
```

Hooks here are pretty special, for each resolver field, you can specify a
pre/post hook that will execute pre and post field resolution.

If your post function accepts four parameters, then it can modify the field
result. It is *required* that the function resolves a promise (or returns) with
the modified value or simply the original if you didn't modify it.

#### Field: `router`

```js
(router) => {
  router.get('/api/v1/people', (req, res) => {
    res.json({people: [{name: 'Bob'}]});
  });
}
```

The Router hook allows you to create a function that accepts the base express
router where you can mount any amount of middleware/routes to do any form of
action needed by external applications. We also provide the authorization
middleware via:

```js
const authorization = require('middleware/authorization');

module.exports = {
  router(router) {
    router.get('/api/v1/people', authorization.needed('ADMIN'), (req, res) => {
      res.json({people: [{name: 'SECRET PEOPLE'}]});
    });
  }
}
```

#### Field: `passport`

```js
const FacebookStrategy = require('passport-facebook').Strategy;
const UsersService = require('services/users');
const {ValidateUserLogin, HandleAuthPopupCallback} = require('services/passport');

module.exports = {
  passport(passport) {
    passport.use(new FacebookStrategy({
      clientID: process.env.TALK_FACEBOOK_APP_ID,
      clientSecret: process.env.TALK_FACEBOOK_APP_SECRET,
      callbackURL: `${process.env.TALK_ROOT_URL}/api/v1/auth/facebook/callback`,
      passReqToCallback: true,
      profileFields: ['id', 'displayName', 'picture.type(large)']
    }, async (req, accessToken, refreshToken, profile, done) => {

      let user;
      try {
        user = await UsersService.findOrCreateExternalUser(profile);
      } catch (err) {
        return done(err);
      }

      return ValidateUserLogin(profile, user, done);
    }));
  },
  router(router) {

    // Note that we have to import the passport instance here, it is
    // instantiated after all the strategies have been mounted.
    const {passport} = require('services/passport');

    /**
     * Facebook auth endpoint, this will redirect the user immediatly to facebook
     * for authorization.
     */
    router.get('/facebook', passport.authenticate('facebook', {display: 'popup', authType: 'rerequest', scope: ['public_profile']}));

    /**
     * Facebook callback endpoint, this will send the user a html page designed to
     * send back the user credentials upon sucesfull login.
     */
    router.get('/facebook/callback', (req, res, next) => {

      // Perform the facebook login flow and pass the data back through the opener.
      passport.authenticate('facebook', HandleAuthPopupCallback(req, res, next))(req, res, next);
    });
  }
};
```

This is a full example including the routes hook to add the required components
to the application router to support a different auth strategy.

### Full Example

Contents of `plugins.json`:

```json
{
  "server": [
    "people"
  ]
}
```

Located in `plugins/people/index.js`:

```js
module.exports = {
  typeDefs: `
  enum COLOUR {
    RED
    BLUE
  }

  type Person {
    name: String!
    colour: COLOUR!
  }

  type RootMutation {
    createPerson(name: String!): Person
  }

  type RootQuery {
    people: [Person!]
  }
  `,
  context: {
    Slack: () => ({
      notify: (message) => {
        // return a promise after we're done sending notifications.
      }
    })
  },
  loaders: ({user}) => ({
    People: {
      load: () => db.people.find({user})
    }
  }),
  mutators: ({user}) => ({
    People: {
      create: (name) => {
        return db.people.insert({user, name});
      }
    }
  }),
  resolvers: {
    Person: {
      name(obj, args, context) {
        return obj.name;
      },
      colour(obj, args, context) {
        // Bill likes the colour red, everyone else likes blue.
        return obj.name === 'bill' ? 'RED' : 'BLUE';
      }
    },
    RootQuery: {
      people(obj, args, {loaders: {People}}) {
        return People.load();
      }
    },
    RootMutation: {
      createPerson(obj, {name}, {mutators: {People}}) {
        return People.create(name);
      }
    }
  },
  hooks: {
    RootMutation: {
      createPerson: {
        post: async (obj, args, {plugins: {Slack}}, info, person) => {
          if (!person) {
            return person;
          }

          await Slack.notify(`A new person just was created with name ${person.name}`);

          return person;
        }
      }
    }
  }
};

```