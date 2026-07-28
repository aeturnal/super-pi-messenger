# Super Pi Messenger Naming Design

**Date:** 2026-07-27  
**Status:** Approved direction; written naming rules awaiting final document review

## 1. Decision

The independently maintained product is named **Super Pi Messenger**.

The name deliberately represents its intended combination of:

- Pi as the coding-agent harness
- pi-messenger as the multi-agent coordination foundation
- Obra Superpowers as the separately installed engineering-methodology source

The product is focused on Superpowers integration. A generic public identity such as “Policy-Aware Crew” is no longer required.

## 2. Naming hierarchy

Use the following hierarchy consistently:

| Concept | Name | Usage |
|---|---|---|
| Complete product | **Super Pi Messenger** | Formal first references, titles, product documentation, and release descriptions |
| Contextual short name | **Super Messenger** | Later references where the Pi context is already unambiguous |
| Multi-agent orchestration feature | **Crew** | Planning, dispatch, work waves, review, repair, and Crew UI |
| Package/repository slug | `super-pi-messenger` | Package and repository naming |

“Crew” remains a feature of Super Pi Messenger rather than becoming part of the formal product name. Prefer phrases such as “start a Crew run in Super Pi Messenger.” Do not use “Super Pi Messenger Crew” as the default full product name.

## 3. Product description

Use this short description where an introductory sentence or tagline is needed:

> Super Pi Messenger is multi-agent orchestration for Pi, powered by independently installed Obra Superpowers.

Longer descriptions may explain that it is an independently maintained fork of pi-messenger that combines pi-messenger’s coordination machinery with stock Superpowers engineering practices.

## 4. Attribution and independence

Documentation must not imply that Super Pi Messenger is an official Obra or Superpowers product.

On the first substantive product description, state that:

- Super Pi Messenger is independently maintained.
- It is based on or forked from `nicobailon/pi-messenger`.
- Obra Superpowers remains a separate stock installation and source of truth.
- The product is not affiliated with or endorsed by Obra unless that status changes explicitly.

Use **Superpowers** only for the actual Obra framework or its installed skills. Use **Super Messenger** only as the contextual short product name.

## 5. Source terminology

Retain `pi-messenger` when referring specifically to:

- The upstream `nicobailon/pi-messenger` project
- Existing paths, commands, APIs, configuration keys, or historical behavior
- Phase 0 eval marker filenames and temporary-directory names, which remain stable so guarded cleanup continues to recognize existing artifacts
- The execution foundation inherited from upstream

Use **Super Pi Messenger** when referring to the independently maintained product being specified or released.

Retain **Crew** for the orchestration subsystem, Crew agents, Crew runs, Crew status, and the Crew UI. This naming decision does not rename commands, configuration keys, source directories, or APIs.

## 6. Initial document changes

Update the approved PRD as follows:

- Change the title from “Policy-Aware Pi-Messenger Crew” to “Super Pi Messenger.”
- Replace the working-name field with a product-name field.
- Replace product-level references to “Policy-Aware Crew” or “Policy-aware Crew” with “Super Pi Messenger.”
- Keep architectural and feature-level uses of “Crew” unchanged.
- Add the independent-product and non-affiliation statement to the product summary.

Update the supporting efficiency design as follows:

- Retitle it for Super Pi Messenger.
- Change product-level introductory references from pi-messenger to Super Pi Messenger.
- Preserve references to upstream pi-messenger when discussing inherited or stock behavior.
- Do not alter the design’s technical decisions as part of the naming-only change.

## 7. Non-goals

This naming change does not:

- Rename Crew
- Rename existing commands or configuration keys
- Rename source directories or TypeScript symbols
- Change the repository's upstream fork relationship
- Publish a package
- Claim official association with Obra Superpowers
- Change approved product requirements or architecture

## 8. Acceptance checks

The naming update is complete when:

1. The PRD formally names the product Super Pi Messenger.
2. Product-level uses of the retired “Policy-Aware Crew” working name are removed.
3. Crew remains the orchestration feature name.
4. The supporting design uses Super Pi Messenger for the product while preserving upstream pi-messenger terminology where technically necessary.
5. The first product summary clearly states independent maintenance, upstream lineage, separately installed stock Superpowers, and non-affiliation.
6. A full-document scan finds no accidental replacement of commands, configuration keys, paths, APIs, or historical upstream references.
