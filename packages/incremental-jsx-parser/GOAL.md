# Goal of this project

Create an incremental JSX parser. The main use case is to render a partially arrived JSX string with React, where incomplete parts of the JSX tree are replaced with a special `<Pending />` component.

This parser is supposed to be used for incrementally rendering AI-generated UI which streams in from a server.

## Interface

The entry point must be a function that accepts a stream as a parameter. It should return an object for tracking the current state of the UI.

1. has a method to obtain the current snapshot of the JSX tree with the Pending component incorporated. 
2. emits an event when the snapshot has an update.

Eventually this parser is going to be severed as a library.

## JSX Spec

The parser needs not be capable of parsing full JavaScript expressions.

1. strings are supported as a JSX attribute (prop="foo").
2. strings, numbers, boolean, null, undefined and other JSX expressions are supported as a string (in {}, as both  props and children). 
3. And other kind of  calculation needs not be  supported.

## Infrastructure

Up to you, but stick to use the latest, modern technology. Check library versions. 