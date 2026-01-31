import { jest } from '@jest/globals';

// Mock mongoose models
export const mockUser = {
    create: jest.fn(),
    findById: jest.fn(),
    deleteMany: jest.fn()
};

export const mockConversation = {
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn()
};

export const mockMessage = {
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn()
};