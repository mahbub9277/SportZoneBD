import * as matchService from './match.service.js';
import { prisma } from '../../core/prisma.js';

export const getAllMatches = async (req, res, next) => {
  try {
    const matches = await matchService.getMatches();
    res.status(200).json(matches);
  } catch (error) {
    res.status(500);
    next(error);
  }
};

export const updateMatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { body, files } = req;

    const existingMatch = await prisma.match.findUnique({
      where: { id },
    });

    if (!existingMatch) {
      res.status(404);
      throw new Error('Match not found.');
    }

    const updatedMatch = await matchService.updateMatch(id, { ...body });

    res.status(200).json(updatedMatch);
  } catch (error) {
    res.status(res.statusCode || 500);
    next(error);
  }
};

export const createMatch = async (req, res, next) => {
  try {
    const { body } = req;
    const matchData = { ...body };


    if (matchData.kickoffAt) {
      matchData.kickoffAt = new Date(matchData.kickoffAt);
    }

    const newMatch = await matchService.createMatch(matchData);

    res.status(201).json(newMatch);
  } catch (error) {
    next(error);
  }
};

export const getMatchById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await matchService.getMatchById(id);
    res.status(200).json(match);
  } catch (error) {
    // If service throws 'Match not found', this will be a 404
    res.status(error.message === 'Match not found' ? 404 : 500);
    next(error);
  }
};