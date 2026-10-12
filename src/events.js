'use strict';
/**
 * Bus d'événements pour Venturi.
 * Permet une communication découplée entre les différents modules.
 */

const EventEmitter = require('events');

/**
 * Types d'événements supportés
 */
const EVENT_TYPES = {
  // Commandes
  COMMAND_GENERATE: 'command:generate',
  COMMAND_COMPILE: 'command:compile',
  COMMAND_SIMULATE: 'command:simulate',
  COMMAND_WAVE: 'command:wave',
  COMMAND_TESTBENCH: 'command:testbench',
  COMMAND_NEW_SCHEMATIC: 'command:new',
  
  // Génération
  GENERATION_START: 'generation:start',
  GENERATION_SUCCESS: 'generation:success',
  GENERATION_ERROR: 'generation:error',
  
  // Compilation
  COMPILATION_START: 'compilation:start',
  COMPILATION_SUCCESS: 'compilation:success',
  COMPILATION_ERROR: 'compilation:error',
  
  // Simulation
  SIMULATION_START: 'simulation:start',
  SIMULATION_SUCCESS: 'simulation:success',
  SIMULATION_ERROR: 'simulation:error',
  
  // Projet
  PROJECT_RESOLVED: 'project:resolved',
  PROJECT_ERROR: 'project:error',
  
  // Éditeur
  EDITOR_READY: 'editor:ready',
  EDITOR_SAVE: 'editor:save',
  EDITOR_ERROR: 'editor:error',
  
  // Logs
  LOG_INFO: 'log:info',
  LOG_WARN: 'log:warn',
  LOG_ERROR: 'log:error'
};

/**
 * Crée un nouveau bus d'événements
 * @returns {EventEmitter} Instance du bus d'événements
 */
function createEventBus() {
  const bus = new EventEmitter();
  
  // Configuration du nombre maximal de listeners
  bus.setMaxListeners(20);
  
  return bus;
}

// Instance globale du bus
const eventBus = createEventBus();

/**
 * Émet un événement sur le bus
 * @param {string} eventType - Type de l'événement
 * @param {any} data - Données associées à l'événement
 */
function emit(eventType, data = {}) {
  eventBus.emit(eventType, data);
  // Log pour le débogage
  if (process.env.NODE_ENV === 'development') {
    console.log(`[EventBus] Emitted: ${eventType}`, data);
  }
}

/**
 * Écoute un événement sur le bus
 * @param {string} eventType - Type de l'événement
 * @param {Function} listener - Fonction de callback
 * @returns {Function} Fonction pour supprimer le listener
 */
function on(eventType, listener) {
  eventBus.on(eventType, listener);
  return () => eventBus.off(eventType, listener);
}

/**
 * Écoute un événement une seule fois
 * @param {string} eventType - Type de l'événement
 * @param {Function} listener - Fonction de callback
 * @returns {Function} Fonction pour supprimer le listener
 */
function once(eventType, listener) {
  eventBus.once(eventType, listener);
  return () => eventBus.off(eventType, listener);
}

/**
 * Supprime tous les listeners pour un type d'événement
 * @param {string} eventType - Type de l'événement
 */
function removeAllListeners(eventType) {
  eventBus.removeAllListeners(eventType);
}

/**
 * Nettoie tous les listeners
 */
function clear() {
  eventBus.removeAllListeners();
}

module.exports = {
  EVENT_TYPES,
  eventBus,
  emit,
  on,
  once,
  removeAllListeners,
  clear,
  createEventBus
};
