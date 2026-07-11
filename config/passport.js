const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/user.model");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_URL || 'http://localhost:8080'}/api/v1/auth/google/callback`,
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          if (user.role === "admin") {
            return done(new Error("Admins are not allowed to log in via Google OAuth. Please use the Admin Portal."), null);
          }
          user.updateLoginActivity();
          await user.save({ validateBeforeSave: false });
          return done(null, user);
        }

        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          if (user.role === "admin") {
            return done(new Error("Admins are not allowed to log in via Google OAuth. Please use the Admin Portal."), null);
          }
          user.googleId = profile.id;
          user.isEmailVerified = true;
          user.updateLoginActivity();
          await user.save({ validateBeforeSave: false });
          return done(null, user);
        }

        user = await User.create({
          googleId: profile.id,
          email: profile.emails[0].value,
          firstName:
            profile.name.givenName || profile.displayName.split(" ")[0],
          lastName:
            profile.name.familyName || profile.displayName.split(" ")[1] || "",
          avatar: profile.photos[0]?.value || null,
          isEmailVerified: true,
        });

        user.updateLoginActivity();
        await user.save({ validateBeforeSave: false });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
