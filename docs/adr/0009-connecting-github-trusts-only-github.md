# Connecting GitHub trusts only GitHub

GitHub warns that the `installation_id` in the address after an install can be forged, and its docs
don't say whether the install page sends back our `state`. So nothing in that address is trusted.

- **Our own authorization gives the only trusted code.** When GitHub returns without our state, RepoScope
  starts its own authorization with a fresh state stored in a short-lived, HttpOnly cookie scoped to
  `/api/github`. Only a code that comes back with that state is used. A forged link can, at worst, make
  victims connect their own installations.
- **The user's token checks, then goes.** The code becomes a user token, which lists the installations
  and repositories the user can see. It's revoked straight after and never stored.
- **An installation links only if the user can see everything it reaches.** Being a member of an
  organization, or a collaborator on one repository of someone else's account, gets an installation
  listed. Linking it would hand over every repository its token reaches, so any repository the user
  can't see refuses the whole installation. Lists are capped at 1,000 repositories, and an installation
  past that is refused rather than half-checked.
- **First to connect owns it.** A second account is told the installation is taken. See
  `docs/adr/0008`.

What this doesn't cover yet: an organization owner can widen an installation after it's connected.
Webhooks see that, but can't check the user without a fresh token, so ticket 06 has to ask the user to
connect again.
